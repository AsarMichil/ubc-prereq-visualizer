/**
 * Loads the baked map and hydrates it into a graphology instance.
 *
 * The payload is tuple-encoded (see scripts/build-artifacts.ts) because
 * repeating key names across ~9.6k nodes costs more than the values do. Node
 * coordinates are already final — nothing here computes a layout.
 */
import Graph from 'graphology';

export const FLAG_GHOST = 1;
export const FLAG_OTHER_CAMPUS = 2;

type NodeTuple = [
	string, // code
	string, // title
	number, // subject index
	number, // course number
	number, // credit min
	number, // credit max
	number, // faculty-layout x
	number, // faculty-layout y
	number, // flags
	number, // relatedness-layout x
	number, // relatedness-layout y
	number // community id, -1 when the course has no prerequisite links
];
type EdgeTuple = [number, number, 0 | 1, string | null];

export interface GraphPayload {
	generatedAt: string;
	fetchedAt: string;
	subjects: string[];
	faculties: string[];
	subjectFaculty: number[];
	facultyBoxes: { name: string; x: number; y: number; width: number; height: number }[];
	communities: {
		id: number;
		label: string;
		x: number;
		y: number;
		size: number;
		radius: number;
	}[];
	nodes: NodeTuple[];
	edges: EdgeTuple[];
	equivalences: number[][];
}

export interface SubjectInfo {
	code: string;
	title: string;
	faculty: string | null;
	department: string | null;
	school: string | null;
	courses: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CourseAttributes {
	label: string;
	title: string;
	subject: string;
	faculty: string | null;
	number: number;
	creditMin: number;
	creditMax: number;
	ghost: boolean;
	otherCampus: boolean;
	/** The live position Sigma renders; animated between the two layouts below. */
	x: number;
	y: number;
	/** Immutable copies of each baked arrangement, since `x`/`y` get overwritten. */
	baseX: number;
	baseY: number;
	clusterX: number;
	clusterY: number;
	/** Community in the relatedness layout, or -1 for a course with no links. */
	community: number;
	size: number;
	color: string;
	/** Dependants minus prerequisites; drives node size and the "roots" filter. */
	inDegree: number;
	outDegree: number;
}

export interface EdgeAttributes {
	/** 0 = prerequisite, 1 = corequisite. */
	kind: 0 | 1;
	/** Shared by alternatives from the same "one of", so they can render together. */
	groupId: string | null;
	color: string;
	size: number;
}

export interface LoadedMap {
	graph: Graph<CourseAttributes, EdgeAttributes>;
	subjects: SubjectInfo[];
	payload: GraphPayload;
}

export async function loadMap(fetcher: typeof fetch = fetch): Promise<LoadedMap> {
	const [payload, subjects] = await Promise.all([
		fetcher('/data/graph.json').then((response) => response.json() as Promise<GraphPayload>),
		fetcher('/data/subjects.json').then((response) => response.json() as Promise<SubjectInfo[]>)
	]);

	const graph = new Graph<CourseAttributes, EdgeAttributes>({ type: 'directed', multi: true });

	const degrees = new Int32Array(payload.nodes.length * 2);
	for (const [from, to] of payload.edges) {
		degrees[to * 2] += 1; // in: prerequisites this course has
		degrees[from * 2 + 1] += 1; // out: courses this one unlocks
	}

	payload.nodes.forEach((tuple, index) => {
		const [
			code,
			title,
			subjectIndex,
			number,
			creditMin,
			creditMax,
			x,
			y,
			flags,
			cx,
			cy,
			community
		] = tuple;
		const subject = payload.subjects[subjectIndex] ?? '';
		const facultyIndex = payload.subjectFaculty[subjectIndex] ?? -1;

		graph.addNode(code, {
			label: code,
			title,
			subject,
			faculty: facultyIndex >= 0 ? payload.faculties[facultyIndex] : null,
			number,
			creditMin,
			creditMax,
			ghost: Boolean(flags & FLAG_GHOST),
			otherCampus: Boolean(flags & FLAG_OTHER_CAMPUS),
			x,
			// The baked layout puts advanced courses at higher y; Sigma's y axis
			// points down, so flip it to keep prerequisites visually below.
			y: -y,
			baseX: x,
			baseY: -y,
			clusterX: cx,
			clusterY: -cy,
			community,
			size: 1,
			color: '#888888',
			inDegree: degrees[index * 2],
			outDegree: degrees[index * 2 + 1]
		});
	});

	payload.edges.forEach(([from, to, kind, groupId], index) => {
		const source = payload.nodes[from][0];
		const target = payload.nodes[to][0];
		graph.addDirectedEdgeWithKey(`e${index}`, source, target, {
			kind,
			groupId,
			color: '#cccccc',
			size: 1
		});
	});

	return { graph, subjects, payload };
}

/** Nodes reachable from `start` within `depth` hops, following edges in one direction. */
export function reachable(
	graph: Graph<CourseAttributes, EdgeAttributes>,
	start: string,
	depth: number,
	direction: 'in' | 'out'
): Set<string> {
	const found = new Set<string>();
	let frontier = [start];

	for (let step = 0; step < depth; step++) {
		const next: string[] = [];
		for (const node of frontier) {
			const neighbours = direction === 'in' ? graph.inNeighbors(node) : graph.outNeighbors(node);
			for (const neighbour of neighbours) {
				if (found.has(neighbour) || neighbour === start) continue;
				found.add(neighbour);
				next.push(neighbour);
			}
		}
		if (!next.length) break;
		frontier = next;
	}

	return found;
}
