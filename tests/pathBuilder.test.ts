import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import { PathBuilderState } from '../src/lib/state/pathBuilder.svelte.ts';
import type { CourseAttributes, EdgeAttributes } from '../src/lib/graph/loadGraph.ts';

/**
 * A stand-in for the real map. Edges point prerequisite -> dependent, matching
 * how the built graph is oriented.
 */
function makeGraph(edges: [string, string][]): Graph<CourseAttributes, EdgeAttributes> {
	const graph = new Graph<CourseAttributes, EdgeAttributes>({ type: 'directed', multi: true });
	const ensure = (code: string) => {
		if (graph.hasNode(code)) return;
		graph.addNode(code, {
			label: code,
			title: code,
			subject: code.split(' ')[0],
			faculty: null,
			number: Number(code.split(' ')[1]) || 0,
			creditMin: 3,
			creditMax: 3,
			ghost: false,
			otherCampus: false,
			x: 0,
			y: 0,
			baseX: 0,
			baseY: 0,
			clusterX: 0,
			clusterY: 0,
			forceX: 0,
			forceY: 0,
			community: -1,
			size: 1,
			color: '#000',
			inDegree: 0,
			outDegree: 0
		});
	};
	for (const [from, to] of edges) {
		ensure(from);
		ensure(to);
		graph.addDirectedEdge(from, to, { kind: 0, groupId: null, color: '#000', size: 1 });
	}
	return graph;
}

/** CPSC 110 -> CPSC 210 -> CPSC 221; MATH 100 feeds both CPSC 221 and STAT 200. */
const sample: [string, string][] = [
	['CPSC 110', 'CPSC 210'],
	['CPSC 210', 'CPSC 221'],
	['MATH 100', 'CPSC 221'],
	['MATH 100', 'STAT 200'],
	['FREN 202', 'FREN 302']
];

function builderWith(): PathBuilderState {
	const builder = new PathBuilderState();
	builder.attach(makeGraph(sample));
	return builder;
}

describe('PathBuilderState', () => {
	it('starts empty and clears back to empty', () => {
		const builder = builderWith();
		expect(builder.isEmpty).toBe(true);

		builder.addRoot('CPSC 221');
		expect(builder.isEmpty).toBe(false);

		builder.clear();
		expect(builder.isEmpty).toBe(true);
		expect(builder.edges).toEqual([]);
		expect(builder.roots).toEqual([]);
	});

	// Two unrelated courses explored at once stay separate components.
	it('keeps unrelated courses as separate roots with no edges between them', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 221');
		builder.addRoot('FREN 302');

		expect(builder.roots).toEqual(['CPSC 221', 'FREN 302']);
		expect(builder.edges).toEqual([]);
		expect(builder.tierOf('CPSC 221')).toBe(0);
		expect(builder.tierOf('FREN 302')).toBe(0);
	});

	// The headline case: a course needed by two others is drawn once, with an
	// edge to each, rather than duplicated.
	it('draws a shared prerequisite once and links it to both dependents', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 221');
		builder.add('CPSC 221', ['MATH 100'], 'back');
		builder.addRoot('STAT 200');

		expect(builder.codes.filter((code) => code === 'MATH 100')).toHaveLength(1);
		expect(builder.edges).toContainEqual({ from: 'MATH 100', to: 'CPSC 221' });
		expect(builder.edges).toContainEqual({ from: 'MATH 100', to: 'STAT 200' });
		// STAT 200 related to something already drawn, so it is not a new root.
		expect(builder.roots).toEqual(['CPSC 221']);
	});

	it('adds an unrelated searched course as its own root', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 221');
		builder.addRoot('FREN 302');
		expect(builder.roots).toContain('FREN 302');
	});

	it('connects a searched course that sits above something drawn', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 210');
		builder.addRoot('CPSC 221'); // CPSC 210 is its prerequisite

		expect(builder.edges).toContainEqual({ from: 'CPSC 210', to: 'CPSC 221' });
		expect(builder.roots).toEqual(['CPSC 210']);
		expect(builder.tierOf('CPSC 221')).toBe(1);
	});

	it('measures depth from the root, negative toward prerequisites', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 221');
		builder.add('CPSC 221', ['CPSC 210'], 'back');
		builder.add('CPSC 210', ['CPSC 110'], 'back');

		expect(builder.tierOf('CPSC 221')).toBe(0);
		expect(builder.tierOf('CPSC 210')).toBe(-1);
		expect(builder.tierOf('CPSC 110')).toBe(-2);
	});

	it('recomputes depth per component when two explorations merge', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 110');
		builder.addRoot('CPSC 221');
		expect(builder.roots).toEqual(['CPSC 110', 'CPSC 221']);

		// CPSC 210 relates to both, so adding it joins the two components.
		builder.add('CPSC 221', ['CPSC 210'], 'back');
		expect(builder.edges).toContainEqual({ from: 'CPSC 110', to: 'CPSC 210' });
		expect(builder.edges).toContainEqual({ from: 'CPSC 210', to: 'CPSC 221' });
		// Depth still reads from a root, whichever reaches it first.
		expect(builder.tierOf('CPSC 110')).toBe(0);
		expect(builder.tierOf('CPSC 221')).toBe(0);
	});

	it('never duplicates a course that is already drawn', () => {
		const builder = builderWith();
		builder.addRoot('CPSC 221');
		builder.add('CPSC 221', ['MATH 100'], 'back');
		builder.add('CPSC 221', ['MATH 100'], 'back');
		expect(builder.codes.filter((code) => code === 'MATH 100')).toHaveLength(1);
		expect(builder.edges.filter((e) => e.from === 'MATH 100' && e.to === 'CPSC 221')).toHaveLength(
			1
		);
	});

	/**
	 * Removal used to delete everything hanging off the removed course, so
	 * removing the course you started from wiped the whole tree. It now trims one
	 * node and lets whatever survives re-root itself.
	 */
	describe('rebalance on removal', () => {
		it('keeps the rest drawn when a middle course is removed', () => {
			const builder = builderWith();
			builder.select('CPSC 221');
			builder.add('CPSC 221', ['CPSC 210'], 'back');
			builder.add('CPSC 210', ['CPSC 110'], 'back');
			builder.select('FREN 302');

			builder.remove('CPSC 210');

			// Nothing is discarded; the chain simply splits in two.
			expect(builder.codes).not.toContain('CPSC 210');
			expect(builder.codes).toEqual(expect.arrayContaining(['CPSC 221', 'CPSC 110', 'FREN 302']));
			// CPSC 110 lost its only link, so it becomes a root of its own.
			expect(builder.roots).toEqual(expect.arrayContaining(['CPSC 221', 'CPSC 110', 'FREN 302']));
		});

		it('re-roots a component when its root is removed', () => {
			const builder = builderWith();
			builder.select('CPSC 221');
			builder.add('CPSC 221', ['CPSC 210'], 'back');
			builder.add('CPSC 210', ['CPSC 110'], 'back');

			builder.remove('CPSC 221');

			expect(builder.codes).toEqual(expect.arrayContaining(['CPSC 210', 'CPSC 110']));
			// The most goal-like survivor is promoted: nothing drawn depends on it.
			expect(builder.roots).toEqual(['CPSC 210']);
			expect(builder.tierOf('CPSC 210')).toBe(0);
			expect(builder.tierOf('CPSC 110')).toBe(-1);
		});

		it('leaves other components untouched', () => {
			const builder = builderWith();
			builder.select('CPSC 221');
			builder.select('FREN 302');
			builder.add('FREN 302', ['FREN 202'], 'back');

			builder.remove('CPSC 221');

			expect(builder.codes).toEqual(expect.arrayContaining(['FREN 302', 'FREN 202']));
			expect(builder.roots).toEqual(['FREN 302']);
		});

		it('gives every component exactly one root', () => {
			const builder = builderWith();
			builder.select('CPSC 221');
			builder.add('CPSC 221', ['CPSC 210', 'MATH 100'], 'back');
			builder.select('FREN 302');

			builder.remove('CPSC 221');
			builder.rebalance();

			// CPSC 210, MATH 100 and FREN 302 are now three separate components.
			expect(builder.roots.sort()).toEqual(['CPSC 210', 'FREN 302', 'MATH 100']);
		});
	});
});
