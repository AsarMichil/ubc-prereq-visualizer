import { describe, expect, it } from 'vitest';
import { tieredLayout } from '../src/lib/graph/layered.ts';

/** Edges point prerequisite -> dependent, matching the built graph. */
const chain = [
	{ source: 'MATH 100', target: 'MATH 101' },
	{ source: 'MATH 101', target: 'MATH 200' },
	{ source: 'MATH 200', target: 'MATH 300' }
];

describe('tieredLayout', () => {
	// Reads top to bottom as early work down to final-year work.
	it('places prerequisites above the courses that need them', () => {
		const result = tieredLayout(
			[
				{ id: 'MATH 100', tier: -3 },
				{ id: 'MATH 101', tier: -2 },
				{ id: 'MATH 200', tier: -1 },
				{ id: 'MATH 300', tier: 0 }
			],
			chain
		);

		const y = (id: string) => result.positions.get(id)!.y;
		expect(y('MATH 100')).toBeLessThan(y('MATH 101'));
		expect(y('MATH 101')).toBeLessThan(y('MATH 200'));
		expect(y('MATH 200')).toBeLessThan(y('MATH 300'));
	});

	/**
	 * Rows used to be centred independently, so a course drifted away from its own
	 * prerequisite whenever the two rows differed in width.
	 */
	it('keeps a course horizontally near its prerequisite', () => {
		const result = tieredLayout(
			[
				// A wide row of unrelated courses sharing a tier with MATH 100.
				{ id: 'MATH 100', tier: -1 },
				{ id: 'OTHR 1', tier: -1 },
				{ id: 'OTHR 2', tier: -1 },
				{ id: 'OTHR 3', tier: -1 },
				{ id: 'OTHR 4', tier: -1 },
				// A single course in the row below, needing only MATH 100.
				{ id: 'MATH 101', tier: 0 }
			],
			[{ source: 'MATH 100', target: 'MATH 101' }]
		);

		const gap = Math.abs(result.positions.get('MATH 100')!.x - result.positions.get('MATH 101')!.x);
		// Directly beneath it, not flung to the far side of the wide row.
		expect(gap).toBeLessThan(1);
	});

	it('never overlaps two courses in the same row', () => {
		const result = tieredLayout(
			[
				{ id: 'A', tier: -1 },
				{ id: 'B', tier: -1 },
				{ id: 'C', tier: -1 },
				{ id: 'GOAL', tier: 0 }
			],
			[
				{ source: 'A', target: 'GOAL' },
				{ source: 'B', target: 'GOAL' },
				{ source: 'C', target: 'GOAL' }
			],
			{ nodeWidth: 100, xGap: 50 }
		);

		const xs = ['A', 'B', 'C'].map((id) => result.positions.get(id)!.x).sort((a, b) => a - b);
		expect(xs[1] - xs[0]).toBeGreaterThanOrEqual(150);
		expect(xs[2] - xs[1]).toBeGreaterThanOrEqual(150);
	});

	it('centres a dependent under several prerequisites', () => {
		const result = tieredLayout(
			[
				{ id: 'A', tier: -1 },
				{ id: 'B', tier: -1 },
				{ id: 'GOAL', tier: 0 }
			],
			[
				{ source: 'A', target: 'GOAL' },
				{ source: 'B', target: 'GOAL' }
			]
		);

		const a = result.positions.get('A')!.x;
		const b = result.positions.get('B')!.x;
		const goal = result.positions.get('GOAL')!.x;
		expect(goal).toBeCloseTo((a + b) / 2, 0);
	});
});
