import { describe, expect, it } from 'vitest';
import { curvatureAround } from '../src/lib/graph/edgeRouting.ts';

const OPTIONS = { clearance: 30, labelWidth: 80 };

describe('curvatureAround', () => {
	it('leaves a clear edge straight', () => {
		expect(curvatureAround({ x: 0, y: 0 }, { x: 0, y: 300 }, [{ x: 280, y: 150 }], OPTIONS)).toBe(
			0
		);
	});

	it('bends an edge that skips a row around the course in it', () => {
		// A->B runs straight through C, which sits in the row between them.
		const curvature = curvatureAround(
			{ x: 0, y: 0 },
			{ x: 0, y: 300 },
			[{ x: 0, y: 150 }],
			OPTIONS
		);
		expect(curvature).not.toBe(0);
	});

	it('bends an edge along a row around the course between its ends', () => {
		const curvature = curvatureAround(
			{ x: 0, y: 0 },
			{ x: 560, y: 0 },
			[{ x: 280, y: 0 }],
			OPTIONS
		);
		expect(curvature).not.toBe(0);
	});

	it('also avoids a label, which runs to the right of its course', () => {
		// The course's mark is left of the edge; its label is what the edge crosses.
		const curvature = curvatureAround(
			{ x: 0, y: 0 },
			{ x: 0, y: 300 },
			[{ x: -50, y: 150 }],
			OPTIONS
		);
		expect(curvature).not.toBe(0);
	});

	it('bows away from the side the course is on', () => {
		// Source below target, course just right of the line: the arc should go left.
		// For an edge pointing up (+y), left is -x, which is positive curvature.
		const curvature = curvatureAround({ x: 0, y: 0 }, { x: 0, y: 300 }, [{ x: 10, y: 150 }], {
			clearance: 30,
			labelWidth: 0
		});
		expect(curvature).toBeGreaterThan(0);
	});

	it('picks the side that clears when the other has a course of its own', () => {
		const curvature = curvatureAround(
			{ x: 0, y: 0 },
			{ x: 0, y: 300 },
			[
				{ x: 0, y: 150 },
				// Blocks the left-hand arcs.
				{ x: -40, y: 150 },
				{ x: -70, y: 150 }
			],
			{ clearance: 30, labelWidth: 0 }
		);
		expect(curvature).toBeLessThan(0);
	});
});
