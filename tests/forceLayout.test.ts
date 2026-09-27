import { describe, expect, it } from 'vitest';
import { forceLayout } from '../scripts/lib/forceLayout.ts';

/**
 * Two cliques joined by a single edge. Any layout worth shipping has to put each
 * clique's members near each other and the two cliques apart.
 */
function twoClusters() {
	const left = ['A 1', 'A 2', 'A 3', 'A 4'];
	const right = ['B 1', 'B 2', 'B 3', 'B 4'];
	const edges: [string, string][] = [];
	for (const group of [left, right]) {
		for (const from of group) for (const to of group) if (from < to) edges.push([from, to]);
	}
	edges.push(['A 1', 'B 1']); // the one tie between them

	const codes = [...left, ...right];
	const communityOf = new Map<string, number>([
		...left.map((code) => [code, 0] as [string, number]),
		...right.map((code) => [code, 1] as [string, number])
	]);
	return {
		codes,
		edges,
		subjectOf: new Map(codes.map((code) => [code, code.split(' ')[0]])),
		communityOf,
		// Every course here has edges, so the two assignments coincide. A course
		// added without edges is deliberately left out, to exercise the fallback.
		assignedCommunity: new Map(communityOf),
		left,
		right
	};
}

const distance = (positions: Map<string, { x: number; y: number }>, a: string, b: string): number =>
	Math.hypot(positions.get(a)!.x - positions.get(b)!.x, positions.get(a)!.y - positions.get(b)!.y);

describe('forceLayout', () => {
	it('separates communities and keeps their members together', () => {
		const input = twoClusters();
		const { positions, quality } = forceLayout(input);

		expect(positions.size).toBe(input.codes.length);
		expect(quality.intra).toBeGreaterThan(0);
		// The whole point of LinLog plus weighted intra-community edges.
		expect(quality.inter).toBeGreaterThan(quality.intra);
		expect(distance(positions, 'A 2', 'A 3')).toBeLessThan(distance(positions, 'A 2', 'B 3'));
	});

	it('is deterministic, because the result is committed to the repo', () => {
		const first = forceLayout(twoClusters()).positions;
		const second = forceLayout(twoClusters()).positions;
		expect([...second]).toEqual([...first]);
	});

	it('places a course that has no edges at all', () => {
		const input = twoClusters();
		// Two thirds of the real corpus looks like this, and the simulation cannot
		// position it: with no edge there is nothing but repulsion acting on it.
		const codes = [...input.codes, 'A 99'];
		const { positions } = forceLayout({
			...input,
			codes,
			subjectOf: new Map([...input.subjectOf, ['A 99', 'A']])
		});

		const point = positions.get('A 99')!;
		expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
		// Parked near its subject's community rather than dumped at the origin.
		expect(distance(positions, 'A 99', 'A 2')).toBeLessThan(distance(positions, 'A 99', 'B 2'));
	});

	it('never emits a non-finite coordinate', () => {
		const { positions } = forceLayout(twoClusters());
		for (const point of positions.values()) {
			expect(Number.isFinite(point.x)).toBe(true);
			expect(Number.isFinite(point.y)).toBe(true);
		}
	});
});

describe('communities the simulation never sees', () => {
	it('gives an entirely edge-less community its own place, not the origin', () => {
		// ASIA and ARTH look like this in the real corpus: a whole community with no
		// prerequisite edge anywhere in it, so ForceAtlas2 never positions a single
		// member and there is nothing to orbit.
		const base = twoClusters();
		const loners = ['C 1', 'C 2', 'C 3', 'C 4', 'C 5'];
		const { positions } = forceLayout({
			codes: [...base.codes, ...loners],
			edges: base.edges,
			subjectOf: new Map([...base.subjectOf, ...loners.map((c) => [c, 'C'] as [string, string])]),
			communityOf: base.communityOf,
			assignedCommunity: new Map([
				...base.assignedCommunity,
				...loners.map((c) => [c, 2] as [string, number])
			])
		});

		const simulatedExtent = Math.max(
			...base.codes.map((code) => Math.hypot(positions.get(code)!.x, positions.get(code)!.y))
		);
		for (const code of loners) {
			const point = positions.get(code)!;
			expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
			// Outside the simulated cloud rather than dumped in the middle of it.
			expect(Math.hypot(point.x, point.y)).toBeGreaterThan(simulatedExtent);
		}

		// And still together, so the group reads as one region.
		expect(distance(positions, 'C 1', 'C 2')).toBeLessThan(simulatedExtent);
	});
});
