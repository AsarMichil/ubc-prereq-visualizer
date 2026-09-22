/* eslint-disable svelte/prefer-svelte-reactivity --
 * The Maps and Sets below are local working collections inside $derived getters
 * and plain methods - adjacency indexes, visited sets - rebuilt from scratch on
 * each call and never read reactively. Reactive state here is the plain arrays
 * (codes, roots, edges); SvelteMap would add proxying to a hot path for nothing.
 */
/**
 * The path builder: a graph of only the courses you have chosen to draw.
 *
 * You start from a course and expand it in either direction - backward toward
 * what it requires, forward toward what it unlocks - one hop at a time. Nothing
 * you did not pick gets drawn, so the view never accumulates the clutter the
 * full map has by design.
 *
 * Several courses can be explored at once. Each becomes a root, and the drawn
 * set is a genuine graph rather than a tree: a course reached from two different
 * places is drawn once with an edge to each, and two separate explorations merge
 * into one component the moment they share a course.
 *
 * Depth is therefore *computed* from the drawn graph rather than stored per
 * node. Storing "hops from the root" would go stale the instant a second root
 * appeared or two components merged.
 */
import type Graph from 'graphology';
import type { CourseAttributes, EdgeAttributes } from '../graph/loadGraph';
import { getCourse, preloadSubjects, type CourseDetail } from '../data/courseDetail';
import { requirementGroups, type RequirementGroup } from '../graph/requirementGroups';

export type Direction = 'back' | 'forward';

/** A drawn edge, always oriented prerequisite -> dependent. */
export interface PathEdge {
	from: string;
	to: string;
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
	/** Courses drawn, in the order they were added. */
	codes = $state<string[]>([]);
	/** Courses explored from directly; each anchors depth for its component. */
	roots = $state<string[]>([]);
	edges = $state<PathEdge[]>([]);

	/** The node whose candidate list is currently open. */
	expanding = $state<{ code: string; direction: Direction } | null>(null);

	groups = $state<RequirementGroup[]>([]);
	forward = $state<ForwardCandidate[]>([]);
	loading = $state(false);
	detail = $state<CourseDetail | null>(null);

	private graph: Graph<CourseAttributes, EdgeAttributes> | null = null;

	attach(graph: Graph<CourseAttributes, EdgeAttributes>): void {
		this.graph = graph;
	}

	has(code: string): boolean {
		return this.codes.includes(code);
	}

	get isEmpty(): boolean {
		return this.codes.length === 0;
	}

	/**
	 * Signed depth per course: negative toward prerequisites, positive toward
	 * dependents, zero at a root.
	 *
	 * Breadth-first from every root at once, so each course takes the reading of
	 * whichever root reaches it first. Anything left unvisited - possible only if
	 * its root was removed - falls back to zero rather than vanishing.
	 */
	tiers = $derived.by(() => {
		const depth = new Map<string, number>();
		const outgoing = new Map<string, string[]>();
		const incoming = new Map<string, string[]>();

		for (const edge of this.edges) {
			(outgoing.get(edge.from) ?? outgoing.set(edge.from, []).get(edge.from)!).push(edge.to);
			(incoming.get(edge.to) ?? incoming.set(edge.to, []).get(edge.to)!).push(edge.from);
		}

		const queue = this.roots.filter((root) => this.has(root));
		for (const root of queue) depth.set(root, 0);

		for (let index = 0; index < queue.length; index++) {
			const code = queue[index];
			const current = depth.get(code)!;

			// Prerequisites sit one level below; dependents one level above.
			for (const prerequisite of incoming.get(code) ?? []) {
				if (depth.has(prerequisite)) continue;
				depth.set(prerequisite, current - 1);
				queue.push(prerequisite);
			}
			for (const dependent of outgoing.get(code) ?? []) {
				if (depth.has(dependent)) continue;
				depth.set(dependent, current + 1);
				queue.push(dependent);
			}
		}

		return this.codes.map((code) => ({ code, tier: depth.get(code) ?? 0 }));
	});

	tierOf(code: string): number {
		return this.tiers.find((entry) => entry.code === code)?.tier ?? 0;
	}

	/** Every drawn course this one is directly related to, in either direction. */
	private relatedTo(code: string): PathEdge[] {
		const graph = this.graph;
		if (!graph?.hasNode(code)) return [];

		const found: PathEdge[] = [];
		for (const other of this.codes) {
			if (other === code || !graph.hasNode(other)) continue;
			if (graph.hasDirectedEdge(other, code)) found.push({ from: other, to: code });
			if (graph.hasDirectedEdge(code, other)) found.push({ from: code, to: other });
		}
		return found;
	}

	private hasEdge(edge: PathEdge): boolean {
		return this.edges.some((existing) => existing.from === edge.from && existing.to === edge.to);
	}

	/**
	 * Draws a course, wiring it to everything already drawn that it directly
	 * relates to. This is what dedupes a shared prerequisite - the second course
	 * needing it gets an edge to the existing node instead of a second copy.
	 */
	private draw(code: string): PathEdge[] {
		const fresh = this.relatedTo(code).filter((edge) => !this.hasEdge(edge));
		if (!this.has(code)) this.codes = [...this.codes, code];
		if (fresh.length) this.edges = [...this.edges, ...fresh];
		return fresh;
	}

	/**
	 * Adds a course explored in its own right.
	 *
	 * It only becomes a root when nothing already drawn relates to it; otherwise
	 * it joins the existing component and takes its depth from there.
	 */
	addRoot(code: string): void {
		const connections = this.draw(code);
		if (connections.length === 0 && !this.roots.includes(code)) {
			this.roots = [...this.roots, code];
		}
		this.rebalance();
		void this.expand(code, 'back');
	}

	/**
	 * Handles a course being chosen - from the search box, or from the canvas.
	 *
	 * Called directly from an event handler, never from an effect. An earlier
	 * version reacted to a `focus` value inside an `$effect` that also read the
	 * drawn set, so removing the focused course re-ran it, found the course
	 * undrawn, and added it straight back. Driving it from the interaction that
	 * caused it removes that feedback loop rather than guarding against it.
	 */
	select(code: string): void {
		if (this.has(code)) void this.expand(code, 'back');
		else this.addRoot(code);
	}

	clear(): void {
		this.codes = [];
		this.roots = [];
		this.edges = [];
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

	/**
	 * Draws the chosen courses one hop out from `parent`.
	 *
	 * The explicit edge to `parent` is added even when the wider graph does not
	 * record one, so a corequisite or an unparsed reference still shows the link
	 * the user just acted on.
	 */
	add(parent: string, codes: string[], direction: Direction): void {
		if (!this.has(parent)) return;

		for (const code of codes) {
			this.draw(code);
			const edge = direction === 'back' ? { from: code, to: parent } : { from: parent, to: code };
			if (!this.hasEdge(edge)) this.edges = [...this.edges, edge];
		}

		this.rebalance();
		this.expanding = null;
	}

	/**
	 * Removes a course, then drops anything left stranded.
	 *
	 * With several roots a course can be reached from more than one place, so
	 * "everything downstream" is no longer well defined. Instead, whatever is no
	 * longer connected to any remaining root goes too - which collapses to the
	 * old behaviour for a single tree.
	 */
	/**
	 * Re-establishes the drawn set's invariants after any change.
	 *
	 * Every mutation funnels through here so the same rules hold no matter how
	 * the set was reached:
	 *
	 *   1. Any two drawn courses with a direct relationship have an edge, in the
	 *      right direction. This is what dedupes a shared prerequisite.
	 *   2. Every connected component has a root, so depth can be measured from
	 *      somewhere. A component that loses its root is given a new one rather
	 *      than being deleted.
	 *   3. Roots that are no longer drawn are dropped.
	 *
	 * Nothing is discarded here. Removing a course used to delete everything that
	 * hung off it, which meant removing the course you started from wiped the
	 * whole tree; now the remainder survives and re-roots itself.
	 */
	rebalance(): void {
		const drawn = new Set(this.codes);
		const graph = this.graph;

		// 1. Edges: keep explicit ones between drawn courses, and re-derive any
		//    relationship the wider graph knows about.
		const edges = this.edges.filter((edge) => drawn.has(edge.from) && drawn.has(edge.to));
		const seen = new Set(edges.map((edge) => `${edge.from}>${edge.to}`));

		if (graph) {
			for (const code of this.codes) {
				if (!graph.hasNode(code)) continue;
				for (const other of this.codes) {
					if (other === code || !graph.hasNode(other)) continue;
					if (graph.hasDirectedEdge(other, code) && !seen.has(`${other}>${code}`)) {
						edges.push({ from: other, to: code });
						seen.add(`${other}>${code}`);
					}
				}
			}
		}

		// 2. Components over the undirected view.
		const neighbours = new Map<string, string[]>();
		const outgoing = new Map<string, number>();
		const incoming = new Map<string, number>();
		for (const edge of edges) {
			(neighbours.get(edge.from) ?? neighbours.set(edge.from, []).get(edge.from)!).push(edge.to);
			(neighbours.get(edge.to) ?? neighbours.set(edge.to, []).get(edge.to)!).push(edge.from);
			outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
			incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
		}

		const componentOf = new Map<string, number>();
		const components: string[][] = [];
		for (const code of this.codes) {
			if (componentOf.has(code)) continue;
			const members: string[] = [];
			const queue = [code];
			componentOf.set(code, components.length);
			for (let index = 0; index < queue.length; index++) {
				members.push(queue[index]);
				for (const next of neighbours.get(queue[index]) ?? []) {
					if (componentOf.has(next)) continue;
					componentOf.set(next, components.length);
					queue.push(next);
				}
			}
			components.push(members);
		}

		// 3. One root per component. An existing root keeps the job; otherwise the
		//    most goal-like member is promoted - nothing drawn depends on it, and
		//    it has the most prerequisites drawn beneath it.
		const existing = new Set(this.roots.filter((root) => drawn.has(root)));
		const roots: string[] = [];

		for (const members of components) {
			const kept = members.filter((code) => existing.has(code));
			if (kept.length) {
				roots.push(...kept);
				continue;
			}

			const terminal = members.filter((code) => (outgoing.get(code) ?? 0) === 0);
			const candidates = terminal.length ? terminal : members;
			const promoted = candidates.reduce((best, code) => {
				const score = incoming.get(code) ?? 0;
				const bestScore = incoming.get(best) ?? 0;
				if (score !== bestScore) return score > bestScore ? code : best;
				return code < best ? code : best;
			}, candidates[0]);
			roots.push(promoted);
		}

		this.edges = edges;
		this.roots = roots;
		if (this.expanding && !drawn.has(this.expanding.code)) this.expanding = null;
	}

	/**
	 * Removes a course. Whatever it connected stays drawn and re-roots itself, so
	 * removing the course you started from trims one node rather than the tree.
	 */
	remove(code: string): void {
		this.codes = this.codes.filter((existing) => existing !== code);
		this.edges = this.edges.filter((edge) => edge.from !== code && edge.to !== code);
		this.roots = this.roots.filter((root) => root !== code);
		this.rebalance();
	}

	/** Courses drawn so far, excluding roots: the plan you have built. */
	chosen = $derived(this.codes.filter((code) => !this.roots.includes(code)).sort());
}
