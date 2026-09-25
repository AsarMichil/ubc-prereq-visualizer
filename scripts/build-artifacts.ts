/**
 * Parses the raw snapshot and emits the artifacts the app loads.
 *
 *   bun scripts/build-artifacts.ts
 *
 * Outputs:
 *   static/data/graph.json        nodes (with baked x/y) + edges, tuple-encoded
 *   static/data/subjects.json     subjects, faculties and subject bounding boxes
 *   static/data/courses/{SUBJ}.json  per-subject detail, fetched lazily
 *   data/coverage.md              parser coverage report (committed, reviewed)
 *
 * Nodes are tuples rather than objects because repeating eight key names across
 * ~9.5k courses costs more than the data itself.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import type { Course, RequirementNode } from '../src/lib/types.ts';
import { buildCoverage, formatCoverage, type ClauseSample } from './lib/coverage.ts';
import { clusterLayout } from './lib/clusterLayout.ts';
import { forceLayout } from './lib/forceLayout.ts';
import { layoutMap } from './lib/layoutMap.ts';
import { loadRaw } from './lib/loadRaw.ts';
import { buildModel, iterateRefs } from './lib/model.ts';
import { parseCourseCode } from './lib/normalizeCode.ts';

const OUT_DIR = 'static/data';

/** Node flag bits, mirrored in src/lib/graph/loadGraph.ts. */
const FLAG_GHOST = 1;
const FLAG_OTHER_CAMPUS = 2;

type EdgeType = 0 | 1; // 0 = prerequisite, 1 = corequisite

interface GhostNode {
	code: string;
	subject: string;
	number: number;
	flags: number;
}

function ghostFor(code: string): GhostNode | null {
	const parsed = parseCourseCode(code);
	if (!parsed) return null;
	return {
		code,
		subject: parsed.subject,
		number: parsed.number,
		flags: FLAG_GHOST | (parsed.campus === 'O' ? FLAG_OTHER_CAMPUS : 0)
	};
}

/** Union-find over equivalency and credit-exclusion statements. */
function equivalenceClasses(courses: Course[], known: Set<string>): string[][] {
	const parent = new Map<string, string>();
	const find = (code: string): string => {
		if (!parent.has(code)) parent.set(code, code);
		let root = parent.get(code)!;
		while (root !== parent.get(root)) root = parent.get(root)!;
		parent.set(code, root);
		return root;
	};
	const union = (a: string, b: string) => {
		const [rootA, rootB] = [find(a), find(b)];
		if (rootA !== rootB) parent.set(rootA, rootB);
	};

	for (const course of courses) {
		for (const other of [...course.equivalentTo, ...course.creditExcludedWith]) {
			if (other !== course.code && known.has(other)) union(course.code, other);
		}
	}

	const groups = new Map<string, string[]>();
	for (const code of parent.keys()) {
		const root = find(code);
		(groups.get(root) ?? groups.set(root, []).get(root)!).push(code);
	}

	return [...groups.values()].filter((group) => group.length > 1).map((group) => group.sort());
}

/** Depth-first cycle detection; a prerequisite cycle means a parse bug. */
function findCycles(nodes: string[], edges: [string, string][]): string[][] {
	const out = new Map<string, string[]>();
	for (const [from, to] of edges) (out.get(from) ?? out.set(from, []).get(from)!).push(to);

	const state = new Map<string, 0 | 1 | 2>();
	const cycles: string[][] = [];
	const stack: string[] = [];

	const visit = (id: string): void => {
		state.set(id, 1);
		stack.push(id);
		for (const next of out.get(id) ?? []) {
			if (state.get(next) === 1) {
				cycles.push([...stack.slice(stack.indexOf(next)), next]);
			} else if (!state.get(next)) {
				visit(next);
			}
		}
		stack.pop();
		state.set(id, 2);
	};

	for (const id of nodes) if (!state.get(id)) visit(id);
	return cycles;
}

async function main(): Promise<void> {
	const raw = await loadRaw();
	const { subjects, courses, skipped } = buildModel(raw);
	console.log(
		`Model: ${courses.length} courses, ${subjects.size} subjects (${skipped} malformed rows skipped)`
	);

	const known = new Set(courses.map((course) => course.code));

	// --- Edges -------------------------------------------------------------
	const edges: { from: string; to: string; type: EdgeType; groupId: string | null }[] = [];
	const ghosts = new Map<string, GhostNode>();
	const seenEdge = new Set<string>();

	const addRefs = (course: Course, tree: RequirementNode | null, type: EdgeType, label: string) => {
		for (const ref of iterateRefs(tree, `${course.code}:${label}`)) {
			if (ref.code === course.code) continue;
			if (!known.has(ref.code) && !ghosts.has(ref.code)) {
				const ghost = ghostFor(ref.code);
				if (ghost) ghosts.set(ref.code, ghost);
			}
			const key = `${ref.code}>${course.code}:${type}:${ref.groupId ?? ''}`;
			if (seenEdge.has(key)) continue;
			seenEdge.add(key);
			edges.push({ from: ref.code, to: course.code, type, groupId: ref.groupId });
		}
	};

	for (const course of courses) {
		addRefs(course, course.prerequisite, 0, 'pre');
		addRefs(course, course.corequisite, 1, 'co');
	}

	const otherCampus = [...ghosts.values()].filter((g) => g.flags & FLAG_OTHER_CAMPUS).length;
	console.log(
		`Edges: ${edges.length} (${edges.filter((e) => e.type === 0).length} prerequisite, ` +
			`${edges.filter((e) => e.type === 1).length} corequisite)`
	);
	console.log(
		`Ghost nodes: ${ghosts.size} referenced but not in the calendar (${otherCampus} Okanagan)`
	);

	// --- Layout ------------------------------------------------------------
	const allNodes = [
		...courses.map((c) => ({ code: c.code, subject: c.subject, number: c.number, flags: 0 })),
		...ghosts.values()
	];

	const bySubject = new Map<string, string[]>();
	const subjectOf = new Map<string, string>();
	for (const node of allNodes) {
		subjectOf.set(node.code, node.subject);
		(bySubject.get(node.subject) ?? bySubject.set(node.subject, []).get(node.subject)!).push(
			node.code
		);
	}

	const prereqPairs = edges
		.filter((e) => e.type === 0)
		.map((e) => [e.from, e.to] as [string, string]);

	const cycles = findCycles(
		allNodes.map((n) => n.code),
		prereqPairs
	);
	if (cycles.length) {
		console.warn(`\n⚠ ${cycles.length} prerequisite cycle(s) — likely parse bugs:`);
		cycles.slice(0, 5).forEach((cycle) => console.warn(`    ${cycle.join(' → ')}`));
	}

	const facultyOf = new Map<string, string | null>();
	for (const subject of bySubject.keys()) {
		facultyOf.set(subject, subjects.get(subject)?.faculty ?? null);
	}

	console.log('\nLaying out the map...');
	const started = Date.now();
	const layout = layoutMap({ bySubject, edges: prereqPairs, subjectOf, facultyOf });

	// A second arrangement of the same courses, positioned by what they actually
	// connect to rather than by which faculty owns them. Both are baked so the
	// client can swap between them without ever running a layout.
	const clustered = clusterLayout({
		codes: allNodes.map((node) => node.code),
		edges: prereqPairs,
		subjectOf
	});
	// A third arrangement: the same communities, but with the edges themselves
	// deciding where each course sits inside one.
	const forced = forceLayout({
		codes: allNodes.map((node) => node.code),
		edges: prereqPairs,
		subjectOf,
		communityOf: clustered.communityOf,
		assignedCommunity: clustered.assignedCommunity
	});

	console.log(
		`Layout done in ${((Date.now() - started) / 1000).toFixed(1)}s ` +
			`(${clustered.communities.length} relatedness communities)`
	);
	console.log(
		`Force layout: mean edge ${forced.quality.intra.toFixed(0)} within a community, ` +
			`${forced.quality.inter.toFixed(0)} across (${forced.quality.ratio.toFixed(2)}x separation)`
	);

	// --- Encode ------------------------------------------------------------
	const subjectCodes = [...bySubject.keys()].sort();
	const subjectIndex = new Map(subjectCodes.map((code, index) => [code, index]));
	const faculties = [
		...new Set([...subjects.values()].map((s) => s.faculty).filter(Boolean))
	].sort() as string[];
	const facultyIndex = new Map(faculties.map((name, index) => [name, index]));

	const nodeOrder = [...allNodes].sort((a, b) => a.code.localeCompare(b.code));
	const nodeIndex = new Map(nodeOrder.map((node, index) => [node.code, index]));
	const courseByCode = new Map(courses.map((course) => [course.code, course]));

	const round = (value: number) => Math.round(value);
	const nodes = nodeOrder.map((node) => {
		const course = courseByCode.get(node.code);
		const point = layout.positions.get(node.code) ?? { x: 0, y: 0 };
		const cluster = clustered.positions.get(node.code) ?? { x: 0, y: 0 };
		const force = forced.positions.get(node.code) ?? { x: 0, y: 0 };
		return [
			node.code,
			course?.title ?? '',
			subjectIndex.get(node.subject) ?? -1,
			node.number,
			course?.credits.min ?? 0,
			course?.credits.max ?? 0,
			round(point.x),
			round(point.y),
			node.flags,
			round(cluster.x),
			round(cluster.y),
			clustered.communityOf.get(node.code) ?? -1,
			round(force.x),
			round(force.y)
		];
	});

	const encodedEdges = edges.map((edge) => [
		nodeIndex.get(edge.from)!,
		nodeIndex.get(edge.to)!,
		edge.type,
		edge.groupId
	]);

	const classes = equivalenceClasses(courses, known);
	const graph = {
		generatedAt: new Date().toISOString(),
		fetchedAt: raw.meta.fetchedAt,
		subjects: subjectCodes,
		faculties,
		subjectFaculty: subjectCodes.map(
			(code) => facultyIndex.get(subjects.get(code)?.faculty ?? '') ?? -1
		),
		// Region boxes let the client label faculties where they actually sit,
		// rather than inferring a centroid from scattered subject positions.
		facultyBoxes: [...layout.faculties.values()].map((box) => ({
			name: box.name,
			x: round(box.x),
			y: round(box.y),
			width: round(box.width),
			height: round(box.height)
		})),
		// Region labels for the relatedness layout, named after their dominant
		// subjects - the equivalent of facultyBoxes for the other arrangement.
		communities: clustered.communities.map((community) => {
			// Same communities, different geometry: the force layout settles them
			// wherever the edges take them, so a label needs its own centre there.
			const force = forced.communities.get(community.id);
			return {
				id: community.id,
				label: community.label,
				x: round(community.x),
				y: round(community.y),
				size: community.size,
				radius: round(community.radius),
				forceX: round(force?.x ?? 0),
				forceY: round(force?.y ?? 0),
				forceRadius: round(force?.radius ?? 0)
			};
		}),
		nodes,
		edges: encodedEdges,
		equivalences: classes.map((group) =>
			group.map((code) => nodeIndex.get(code)).filter((i) => i !== undefined)
		)
	};

	await rm(OUT_DIR, { recursive: true, force: true });
	await mkdir(join(OUT_DIR, 'courses'), { recursive: true });

	const graphJson = JSON.stringify(graph);
	await writeFile(join(OUT_DIR, 'graph.json'), graphJson);

	const subjectPayload = subjectCodes.map((code) => {
		const subject = subjects.get(code);
		const box = layout.boxes.get(code);
		return {
			code,
			title: subject?.title ?? code,
			faculty: subject?.faculty ?? null,
			department: subject?.department ?? null,
			school: subject?.school ?? null,
			courses: bySubject.get(code)?.length ?? 0,
			x: round(box?.x ?? 0),
			y: round(box?.y ?? 0),
			width: round(box?.width ?? 0),
			height: round(box?.height ?? 0)
		};
	});
	await writeFile(join(OUT_DIR, 'subjects.json'), JSON.stringify(subjectPayload));

	const detailBySubject = new Map<string, Record<string, unknown>>();
	for (const course of courses) {
		const bucket = detailBySubject.get(course.subject) ?? {};
		bucket[course.code] = {
			title: course.title,
			description: course.sections.descriptionText,
			hours: course.sections.hoursVector,
			credits: course.credits,
			prerequisite: course.prerequisite,
			corequisite: course.corequisite,
			prerequisiteText: course.sections.prerequisiteText,
			corequisiteText: course.sections.corequisiteText,
			notes: course.sections.notes,
			equivalentTo: course.equivalentTo,
			creditExcludedWith: course.creditExcludedWith,
			url: course.url
		};
		detailBySubject.set(course.subject, bucket);
	}
	await Promise.all(
		[...detailBySubject].map(([subject, bucket]) =>
			writeFile(join(OUT_DIR, 'courses', `${subject}.json`), JSON.stringify(bucket))
		)
	);

	// --- Coverage ----------------------------------------------------------
	const samples: ClauseSample[] = [];
	for (const course of courses) {
		if (course.sections.prerequisiteText) {
			samples.push({
				course: course.code,
				kind: 'prerequisite',
				text: course.sections.prerequisiteText,
				ast: course.prerequisite
			});
		}
		if (course.sections.corequisiteText) {
			samples.push({
				course: course.code,
				kind: 'corequisite',
				text: course.sections.corequisiteText,
				ast: course.corequisite
			});
		}
	}
	const coverage = buildCoverage(samples);
	await mkdir('data', { recursive: true });
	await writeFile('data/coverage.md', formatCoverage(coverage, raw.meta.fetchedAt));

	const brotli = brotliCompressSync(Buffer.from(graphJson)).byteLength;
	console.log(
		`\ngraph.json ${(graphJson.length / 1024).toFixed(0)}KB raw / ${(brotli / 1024).toFixed(0)}KB brotli`
	);
	console.log(`courses/*.json: ${detailBySubject.size} files`);
	console.log(`equivalence classes: ${classes.length}`);
	console.log(
		`coverage: ${coverage.clauses} clauses, ${coverage.missingCodes.length} dropping a code, ` +
			`${(coverage.freeTextRatio * 100).toFixed(1)}% free text`
	);

	// A dropped code is a silent missing edge; never let it pass unnoticed.
	if (coverage.missingCodes.length > 0) {
		console.error('\n✗ Parser dropped course codes — see data/coverage.md');
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
