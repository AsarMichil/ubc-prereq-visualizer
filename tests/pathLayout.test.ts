import { describe, expect, it } from 'vitest';
import { pathLayout, type LayoutEdge } from '../src/lib/graph/layered.ts';

/** The builder's spacing, so "too close" means what it means on screen. */
const OPTIONS = { nodeWidth: 150, nodeHeight: 40, xGap: 130, yGap: 110 };
/**
 * A line this close to a course's centre crosses the course itself. Edges do
 * pass nearer than a full label width - every edge converges on its target, past
 * that row's other courses - but none may cut through a node.
 */
const CLEARANCE = OPTIONS.nodeHeight / 2;

type Point = { x: number; y: number };

function distanceToSegment(p: Point, a: Point, b: Point): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Every course lying on an edge it is not an endpoint of, as "course on source>target". */
function collisions(ids: string[], edges: LayoutEdge[]): string[] {
	const result = pathLayout(ids, edges, OPTIONS);
	const found: string[] = [];

	for (const edge of edges) {
		const path = [
			result.positions.get(edge.source)!,
			...(result.bends.get(`${edge.source}>${edge.target}`) ?? []),
			result.positions.get(edge.target)!
		];
		for (const id of ids) {
			if (id === edge.source || id === edge.target) continue;
			const point = result.positions.get(id)!;
			for (let i = 1; i < path.length; i++) {
				if (distanceToSegment(point, path[i - 1], path[i]) < CLEARANCE) {
					found.push(`${id} on ${edge.source}>${edge.target}`);
					break;
				}
			}
		}
	}
	return found;
}

describe('pathLayout', () => {
	it('keeps a course off an edge that skips its row', () => {
		// A needs B directly and through M, so A->B spans M's row. C is unrelated
		// and used to be packed onto the A->B line.
		const ids = ['A', 'B', 'C', 'M', 'N'];
		const edges = [
			{ source: 'A', target: 'B' },
			{ source: 'A', target: 'M' },
			{ source: 'M', target: 'B' },
			{ source: 'N', target: 'C' }
		];
		expect(collisions(ids, edges)).toEqual([]);
		expect(pathLayout(ids, edges, OPTIONS).bends.get('A>B')).toHaveLength(1);
	});

	it('never draws an edge along a row', () => {
		// P and Q were both one hop from R, so P->Q ran along their shared row.
		const result = pathLayout(
			['R', 'P', 'Q', 'X'],
			[
				{ source: 'P', target: 'R' },
				{ source: 'Q', target: 'R' },
				{ source: 'P', target: 'Q' },
				{ source: 'X', target: 'R' }
			],
			OPTIONS
		);
		const y = (id: string) => result.positions.get(id)!.y;
		expect(y('P')).toBeLessThan(y('Q'));
		expect(y('Q')).toBeLessThan(y('R'));
	});

	it('sinks a course with no prerequisites to just above what needs it', () => {
		const result = pathLayout(
			['A', 'B', 'C', 'D', 'Z'],
			[
				{ source: 'A', target: 'B' },
				{ source: 'B', target: 'C' },
				{ source: 'C', target: 'D' },
				{ source: 'Z', target: 'D' }
			],
			OPTIONS
		);
		expect(result.positions.get('Z')!.y).toBe(result.positions.get('C')!.y);
		expect(result.bends.size).toBe(0);
	});

	it('does not report bend points as courses', () => {
		const result = pathLayout(
			['A', 'B', 'M'],
			[
				{ source: 'A', target: 'M' },
				{ source: 'M', target: 'B' },
				{ source: 'A', target: 'B' }
			],
			OPTIONS
		);
		expect([...result.positions.keys()].sort()).toEqual(['A', 'B', 'M']);
	});

	it('keeps every course off every edge across random prerequisite graphs', () => {
		// Small seeded LCG, so a failure reproduces.
		let seed = 7;
		const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

		for (let trial = 0; trial < 500; trial++) {
			const count = 3 + Math.floor(random() * 10);
			const ids = Array.from({ length: count }, (_, index) => `C${index}`);
			const edges: LayoutEdge[] = [];
			// Edges only run from a lower index to a higher one, so the graph is a
			// DAG, as a prerequisite graph is.
			for (let from = 0; from < count; from++) {
				for (let to = from + 1; to < count; to++) {
					if (random() < 0.25) edges.push({ source: ids[from], target: ids[to] });
				}
			}
			expect(collisions(ids, edges), `trial ${trial}: ${JSON.stringify(edges)}`).toEqual([]);
		}
	});
});
