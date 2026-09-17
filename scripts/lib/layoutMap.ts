/**
 * Bakes the whole-map layout at build time.
 *
 * Doing this offline is what makes the Figma-style client possible: the browser
 * never runs a layout algorithm, so first paint is instant, filters are purely
 * visual (they dim rather than reflow), and the map is spatially stable across
 * visits so people can build a mental model of where things live.
 *
 * The hierarchy is packed, not merely attracted. An earlier version placed all
 * 264 subjects in one force pass and used weak same-faculty edges to pull
 * faculties together; that failed - subjects scattered, and every faculty's
 * centroid collapsed onto the middle of the map, making region labels useless.
 * Containment has to be structural:
 *
 *   1. Courses within a subject - layered by prerequisite depth, with the
 *      unconnected majority in a compact grid above.
 *   2. Subjects within their faculty - shelf-packed in an order derived from
 *      cross-subject prerequisite ties, so related disciplines sit together
 *      inside one dense region.
 *   3. Faculties across the plane - the same packing over the ~14 faculty
 *      boxes, ordered by how much their curricula reference each other.
 */
import { gridLayout, layeredLayout } from '../../src/lib/graph/layered.ts';

export interface SubjectBox {
	code: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FacultyBox {
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MapLayout {
	positions: Map<string, { x: number; y: number }>;
	boxes: Map<string, SubjectBox>;
	faculties: Map<string, FacultyBox>;
}

const tieKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

const SUBJECT_GAP = 220;
const FACULTY_GAP = 900;
const OTHER = 'Other';

interface LayoutInput {
	bySubject: Map<string, string[]>;
	edges: [string, string][];
	subjectOf: Map<string, string>;
	facultyOf: Map<string, string | null>;
}

interface Block {
	positions: Map<string, { x: number; y: number }>;
	width: number;
	height: number;
}

/** Lays out one subject's courses and returns the block's size. */
function layoutSubject(codes: string[], internal: [string, string][]): Block {
	const connected = new Set<string>();
	for (const [from, to] of internal) {
		connected.add(from);
		connected.add(to);
	}

	const linked = codes.filter((code) => connected.has(code));
	const isolated = codes.filter((code) => !connected.has(code));

	const chains = layeredLayout(
		linked.map((id) => ({ id })),
		internal.map(([source, target]) => ({ source, target }))
	);
	// Wide-ish grid: subjects that are mostly unconnected should read as a broad
	// band rather than a tall column, which keeps the whole map closer to square.
	const loose = gridLayout(isolated, {
		columns: Math.max(6, Math.ceil(Math.sqrt(isolated.length * 3)))
	});

	const positions = new Map<string, { x: number; y: number }>();
	const width = Math.max(chains.width, loose.width, 1);
	const gap = linked.length && isolated.length ? 140 : 0;

	// Unconnected courses sit above; prerequisite chains hang below them so the
	// layered structure is what you see first when zooming into a subject.
	for (const [id, point] of loose.positions) {
		positions.set(id, { x: point.x + (width - loose.width) / 2, y: point.y });
	}
	for (const [id, point] of chains.positions) {
		positions.set(id, { x: point.x + (width - chains.width) / 2, y: point.y + loose.height + gap });
	}

	return {
		positions,
		width,
		height: Math.max(chains.height + loose.height + gap, 1)
	};
}

interface Placeable {
	key: string;
	width: number;
	height: number;
	x: number;
	y: number;
}

/**
 * Orders boxes so strongly tied ones end up near each other, then packs them.
 *
 * A force pass was tried here first and produced hollow rings: inside a faculty
 * most subject pairs share no prerequisites at all, so the only force acting on
 * them was mutual repulsion, which pushed them out onto the seed circle and left
 * a large hole in the middle of every region. Packing is denser, deterministic,
 * and keeps regions close to square.
 */
function orderByTies(items: Placeable[], ties: Map<string, number>): Placeable[] {
	if (items.length < 3) return [...items];

	const weightOf = (a: string, b: string) => ties.get(tieKey(a, b)) ?? 0;
	const remaining = new Map(items.map((item) => [item.key, item]));

	// Start from the most connected box so the chain grows from the region's hub.
	let current = items.reduce((best, item) => {
		const score = (candidate: Placeable) =>
			items.reduce((sum, other) => sum + weightOf(candidate.key, other.key), 0);
		return score(item) > score(best) ? item : best;
	}, items[0]);

	const ordered: Placeable[] = [];
	while (remaining.size) {
		remaining.delete(current.key);
		ordered.push(current);
		if (!remaining.size) break;

		let next: Placeable | null = null;
		let bestWeight = -1;
		for (const candidate of remaining.values()) {
			const weight = weightOf(current.key, candidate.key);
			// Ties broken by size keeps the packing tidy and the result stable.
			if (
				weight > bestWeight ||
				(weight === bestWeight && next && candidate.height > next.height)
			) {
				bestWeight = weight;
				next = candidate;
			}
		}
		current = next!;
	}

	return ordered;
}

/** Shelf-packs boxes into rows, targeting a roughly square region. */
function packBoxes(items: Placeable[], ties: Map<string, number>, padding: number): void {
	if (items.length === 0) return;
	if (items.length === 1) {
		items[0].x = 0;
		items[0].y = 0;
		return;
	}

	const ordered = orderByTies(items, ties);
	const totalArea = ordered.reduce(
		(sum, item) => sum + (item.width + padding) * (item.height + padding),
		0
	);
	const targetWidth = Math.max(Math.sqrt(totalArea * 1.15), ordered[0].width + padding);

	let cursorX = 0;
	let rowTop = 0;
	let rowHeight = 0;

	for (const item of ordered) {
		const boxWidth = item.width + padding;
		if (cursorX > 0 && cursorX + boxWidth > targetWidth) {
			rowTop += rowHeight;
			cursorX = 0;
			rowHeight = 0;
		}
		item.x = cursorX + boxWidth / 2;
		item.y = rowTop + (item.height + padding) / 2;
		cursorX += boxWidth;
		rowHeight = Math.max(rowHeight, item.height + padding);
	}
}

function countTies(
	edges: [string, string][],
	groupOf: (code: string) => string | undefined
): Map<string, number> {
	const ties = new Map<string, number>();
	for (const [from, to] of edges) {
		const a = groupOf(from);
		const b = groupOf(to);
		if (!a || !b || a === b) continue;
		const key = tieKey(a, b);
		ties.set(key, (ties.get(key) ?? 0) + 1);
	}
	return ties;
}

export function layoutMap(input: LayoutInput): MapLayout {
	// 1. Courses within each subject.
	const blocks = new Map<string, Block>();
	for (const [subject, codes] of input.bySubject) {
		const inSubject = new Set(codes);
		const internal = input.edges.filter(([from, to]) => inSubject.has(from) && inSubject.has(to));
		blocks.set(subject, layoutSubject(codes, internal));
	}

	const facultyName = (subject: string) => input.facultyOf.get(subject) ?? OTHER;

	// 2. Subjects within each faculty.
	const subjectTies = countTies(input.edges, (code) => input.subjectOf.get(code));
	const byFaculty = new Map<string, Placeable[]>();

	for (const [subject, block] of blocks) {
		const faculty = facultyName(subject);
		const list = byFaculty.get(faculty) ?? byFaculty.set(faculty, []).get(faculty)!;
		list.push({ key: subject, width: block.width, height: block.height, x: 0, y: 0 });
	}

	const facultyBoxes: Placeable[] = [];
	for (const [faculty, members] of byFaculty) {
		// Only ties internal to this faculty influence the arrangement inside it.
		const internalTies = new Map<string, number>();
		const inFaculty = new Set(members.map((member) => member.key));
		for (const [key, weight] of subjectTies) {
			const [a, b] = key.split(' ');
			if (inFaculty.has(a) && inFaculty.has(b)) internalTies.set(key, weight);
		}

		packBoxes(members, internalTies, SUBJECT_GAP);

		const left = Math.min(...members.map((m) => m.x - m.width / 2));
		const right = Math.max(...members.map((m) => m.x + m.width / 2));
		const top = Math.min(...members.map((m) => m.y - m.height / 2));
		const bottom = Math.max(...members.map((m) => m.y + m.height / 2));

		// Re-centre members on the region origin so the faculty box is its own frame.
		const centreX = (left + right) / 2;
		const centreY = (top + bottom) / 2;
		for (const member of members) {
			member.x -= centreX;
			member.y -= centreY;
		}

		facultyBoxes.push({
			key: faculty,
			width: right - left,
			height: bottom - top,
			x: 0,
			y: 0
		});
	}

	// 3. Faculties across the plane.
	const facultyTies = countTies(input.edges, (code) => {
		const subject = input.subjectOf.get(code);
		return subject ? facultyName(subject) : undefined;
	});
	packBoxes(facultyBoxes, facultyTies, FACULTY_GAP);

	// 4. Compose absolute positions.
	const positions = new Map<string, { x: number; y: number }>();
	const boxes = new Map<string, SubjectBox>();
	const faculties = new Map<string, FacultyBox>();

	for (const box of facultyBoxes) {
		faculties.set(box.key, {
			name: box.key,
			x: box.x,
			y: box.y,
			width: box.width,
			height: box.height
		});

		for (const member of byFaculty.get(box.key) ?? []) {
			const block = blocks.get(member.key)!;
			const centreX = box.x + member.x;
			const centreY = box.y + member.y;

			boxes.set(member.key, {
				code: member.key,
				x: centreX,
				y: centreY,
				width: block.width,
				height: block.height
			});

			const originX = centreX - block.width / 2;
			const originY = centreY - block.height / 2;
			for (const [code, point] of block.positions) {
				positions.set(code, { x: originX + point.x, y: originY + point.y });
			}
		}
	}

	return { positions, boxes, faculties };
}
