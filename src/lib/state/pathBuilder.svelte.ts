/**
 * The path builder: an explorable tree that grows outward from one course.
 *
 * Unlike the map, this draws only what you have chosen to draw. You start from
 * a course and expand it in either direction - backward toward what it requires,
 * forward toward what it unlocks - one hop at a time. Everything you did not
 * pick stays undrawn, so the view never accumulates the clutter the full map
 * has by design.
 *
 * The two directions share one interaction (select 1..n candidates) but differ
 * in meaning: backward, a course's requirement rows say how many you actually
 * need; forward, nothing is required and the list is simply ranked.
 */
import type Graph from 'graphology';
import type { CourseAttributes, EdgeAttributes } from '../graph/loadGraph';
import { getCourse, preloadSubjects, type CourseDetail } from '../data/courseDetail';
import { requirementGroups, type RequirementGroup } from '../graph/requirementGroups';

export type Direction = 'back' | 'forward';

export interface PathNode {
	code: string;
	/**
	 * Signed hop distance from the root: negative toward prerequisites, positive
	 * toward dependents. This is the row a node is drawn in, and the value the
	 * colour ramp keys off.
	 */
	tier: number;
	/** The node this was expanded from; null for the root. */
	parent: string | null;
	direction: Direction | 'root';
}

export interface ForwardCandidate {
	code: string;
	title: string;
	/** How many further courses this one opens up; used to rank the list. */
	unlocks: number;
	year: number;
	subject: string;
}

export class PathBuilderState {
	root = $state<string | null>(null);
	/** Drawn nodes, keyed by course code. */
	nodes = $state<PathNode[]>([]);
	/** The node whose candidate list is currently open. */
	expanding = $state<{ code: string; direction: Direction } | null>(null);

	/** Requirement rows for the course being expanded backward. */
	groups = $state<RequirementGroup[]>([]);
	/** Ranked dependents for the course being expanded forward. */
	forward = $state<ForwardCandidate[]>([]);
	loading = $state(false);
	detail = $state<CourseDetail | null>(null);

	private graph: Graph<CourseAttributes, EdgeAttributes> | null = null;

	attach(graph: Graph<CourseAttributes, EdgeAttributes>): void {
		this.graph = graph;
	}

	has(code: string): boolean {
		return this.nodes.some((node) => node.code === code);
	}

	nodeAt(code: string): PathNode | undefined {
		return this.nodes.find((node) => node.code === code);
	}

	/** Rows of the tree, ordered from deepest prerequisite to furthest dependent. */
	tiers = $derived.by(() => {
		// Rebuilt from scratch on every change and never mutated afterwards, so
		// plain Map is correct - SvelteMap would add proxying for no benefit.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const byTier = new Map<number, PathNode[]>();
		for (const node of this.nodes) {
			const list = byTier.get(node.tier) ?? byTier.set(node.tier, []).get(node.tier)!;
			list.push(node);
		}
		return [...byTier.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([tier, nodes]) => ({ tier, nodes }));
	});

	/** Edges between drawn nodes, so the view can connect them. */
	links = $derived.by(() =>
		this.nodes
			.filter((node) => node.parent)
			.map((node) =>
				node.direction === 'back'
					? { from: node.code, to: node.parent! }
					: { from: node.parent!, to: node.code }
			)
	);

	start(code: string): void {
		this.root = code;
		this.nodes = [{ code, tier: 0, parent: null, direction: 'root' }];
		this.expanding = null;
		this.groups = [];
		this.forward = [];
		void this.expand(code, 'back');
	}

	clear(): void {
		this.root = null;
		this.nodes = [];
		this.expanding = null;
		this.groups = [];
		this.forward = [];
		this.detail = null;
	}

	/** Opens the candidate list for a course in one direction. */
	async expand(code: string, direction: Direction): Promise<void> {
		this.expanding = { code, direction };
		this.loading = true;
		this.groups = [];
		this.forward = [];

		try {
			const detail = await getCourse(code);
			this.detail = detail;

			if (direction === 'back') {
				this.groups = requirementGroups(detail?.prerequisite ?? null);
				await preloadSubjects(
					this.groups.flatMap((group) =>
						group.options.flatMap((option) =>
							option.kind === 'course'
								? [option.code]
								: option.kind === 'compound'
									? option.courses
									: []
						)
					)
				);
			} else {
				this.forward = this.dependentsOf(code);
			}
		} finally {
			this.loading = false;
		}
	}

	private dependentsOf(code: string): ForwardCandidate[] {
		const graph = this.graph;
		if (!graph?.hasNode(code)) return [];

		return (
			graph
				.outNeighbors(code)
				.map((neighbour) => {
					const attributes = graph.getNodeAttributes(neighbour);
					return {
						code: neighbour,
						title: attributes.title,
						unlocks: attributes.outDegree,
						year: Math.floor(attributes.number / 100),
						subject: attributes.subject
					};
				})
				// Courses that themselves open the most doors come first: with 37
				// dependents to choose between, that is the ordering that helps.
				.sort((a, b) => b.unlocks - a.unlocks || a.code.localeCompare(b.code))
		);
	}

	/** Draws the chosen courses one hop out from `parent`. */
	add(parent: string, codes: string[], direction: Direction): void {
		const parentNode = this.nodeAt(parent);
		if (!parentNode) return;

		const tier = parentNode.tier + (direction === 'back' ? -1 : 1);
		const added: PathNode[] = [];

		for (const code of codes) {
			if (this.has(code)) continue;
			added.push({ code, tier, parent, direction });
		}

		if (added.length) this.nodes = [...this.nodes, ...added];
		this.expanding = null;
	}

	/**
	 * Removes a course and everything drawn beyond it.
	 *
	 * Revising an early decision has to discard what followed from it, otherwise
	 * the tree would keep showing branches that are no longer reachable.
	 */
	remove(code: string): void {
		if (code === this.root) {
			this.clear();
			return;
		}

		// A local working set inside a plain function; nothing reactive reads it.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const doomed = new Set([code]);
		let changed = true;
		while (changed) {
			changed = false;
			for (const node of this.nodes) {
				if (node.parent && doomed.has(node.parent) && !doomed.has(node.code)) {
					doomed.add(node.code);
					changed = true;
				}
			}
		}

		this.nodes = this.nodes.filter((node) => !doomed.has(node.code));
		if (this.expanding && doomed.has(this.expanding.code)) this.expanding = null;
	}

	/** Courses drawn so far, excluding the root: the plan you have built. */
	chosen = $derived(
		this.nodes
			.filter((node) => node.direction !== 'root')
			.map((node) => node.code)
			.sort()
	);
}
