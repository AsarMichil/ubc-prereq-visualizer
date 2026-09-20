/* eslint-disable svelte/prefer-svelte-reactivity --
 * The Sets and URLSearchParams here are all freshly constructed inside $derived
 * getters or returned from pure methods, and are never mutated after creation,
 * so reactivity already tracks them correctly. SvelteSet would add proxy
 * overhead on a hot path that rebuilds a ~9.6k-entry Set on every filter change.
 */
/**
 * Explorer state.
 *
 * Filters never change the graph's structure or positions — they only decide how
 * each node is painted. That is what keeps the map spatially stable: toggling a
 * faculty lights up a region instead of reshuffling the canvas.
 */
import type { CourseAttributes, EdgeAttributes, LoadedMap } from '../graph/loadGraph.ts';
import { reachable } from '../graph/loadGraph.ts';
import { yearTier, type Theme } from '../graph/palette.ts';

export type NodeRole = 'normal' | 'selected' | 'prerequisite' | 'unlocks';

const ALL_YEARS = [0, 1, 2, 3, 4];
const UNDERGRAD_YEARS = [0, 1, 2, 3];

export class ExplorerState {
	/**
	 * Raw, not deep: the map is assigned once on load and only ever read.
	 *
	 * Plain `$state` would proxy it deeply - roughly 18,000 arrays between
	 * `payload.nodes`, `payload.edges` and `equivalences` - so every lookup during
	 * a render would go through a proxy for reactivity we never use.
	 */
	map = $state.raw<LoadedMap | null>(null);
	theme = $state<Theme>('light');

	/** Year tiers (see palette.yearTier). Graduate is off by default — it is over a third of the corpus. */
	years = $state<number[]>([...UNDERGRAD_YEARS]);
	faculties = $state<string[]>([]);
	subjects = $state<string[]>([]);
	hideIsolated = $state(false);
	showGhosts = $state(false);
	query = $state('');

	focus = $state<string | null>(null);
	depth = $state(2);
	/** When on, the focused neighbourhood is redrawn as a clean layered chain. */
	straighten = $state(false);

	/** Camera zoom, mirrored from Sigma so the UI can react to LOD tier. */
	cameraRatio = $state(1);

	get tier(): 'far' | 'mid' | 'near' {
		if (this.cameraRatio > 0.45) return 'far';
		if (this.cameraRatio > 0.12) return 'mid';
		return 'near';
	}

	readonly allYears = ALL_YEARS;

	/** Courses passing the current filters, by code. */
	filtered = $derived.by(() => {
		const map = this.map;
		const passing = new Set<string>();
		if (!map) return passing;

		const years = new Set(this.years);
		const faculties = new Set(this.faculties);
		const subjects = new Set(this.subjects);
		const query = this.query.trim().toLowerCase();

		map.graph.forEachNode((code, attributes) => {
			if (attributes.ghost && !this.showGhosts) return;
			if (!attributes.ghost && !years.has(yearTier(attributes.number))) return;
			if (faculties.size && !(attributes.faculty && faculties.has(attributes.faculty))) return;
			if (subjects.size && !subjects.has(attributes.subject)) return;
			if (this.hideIsolated && attributes.inDegree === 0 && attributes.outDegree === 0) return;
			if (
				query &&
				!code.toLowerCase().includes(query) &&
				!attributes.title.toLowerCase().includes(query)
			) {
				return;
			}
			passing.add(code);
		});

		return passing;
	});

	/** Prerequisite ancestors and dependent descendants of the focused course. */
	focusSets = $derived.by(() => {
		const map = this.map;
		const focus = this.focus;
		if (!map || !focus || !map.graph.hasNode(focus)) {
			return { prerequisites: new Set<string>(), unlocks: new Set<string>() };
		}
		return {
			prerequisites: reachable(map.graph, focus, this.depth, 'in'),
			unlocks: reachable(map.graph, focus, this.depth, 'out')
		};
	});

	/** True when a focus is active, so the canvas knows to dim everything else. */
	hasFocus = $derived(Boolean(this.focus && this.map?.graph.hasNode(this.focus)));

	roleOf(code: string): NodeRole {
		if (!this.focus) return 'normal';
		if (code === this.focus) return 'selected';
		if (this.focusSets.prerequisites.has(code)) return 'prerequisite';
		if (this.focusSets.unlocks.has(code)) return 'unlocks';
		return 'normal';
	}

	/** Nodes in the focused neighbourhood, including the focus itself. */
	focusNeighbourhood = $derived.by(() => {
		const all = new Set<string>(this.focusSets.prerequisites);
		for (const code of this.focusSets.unlocks) all.add(code);
		if (this.focus) all.add(this.focus);
		return all;
	});

	get facultyOptions(): string[] {
		return this.map?.payload.faculties ?? [];
	}

	toggleYear(tier: number): void {
		this.years = this.years.includes(tier)
			? this.years.filter((value) => value !== tier)
			: [...this.years, tier].sort();
	}

	toggleFaculty(name: string): void {
		this.faculties = this.faculties.includes(name)
			? this.faculties.filter((value) => value !== name)
			: [...this.faculties, name];
	}

	setSubject(code: string | null): void {
		this.subjects = code ? [code] : [];
	}

	reset(): void {
		this.years = [...UNDERGRAD_YEARS];
		this.faculties = [];
		this.subjects = [];
		this.hideIsolated = false;
		this.showGhosts = false;
		this.query = '';
		this.focus = null;
		this.straighten = false;
	}

	/** Serializes the current view so any state is shareable as a URL. */
	toSearchParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (this.years.join() !== UNDERGRAD_YEARS.join()) params.set('years', this.years.join(','));
		if (this.faculties.length) params.set('faculty', this.faculties.join(','));
		if (this.subjects.length) params.set('subject', this.subjects.join(','));
		if (this.query.trim()) params.set('q', this.query.trim());
		if (this.focus) params.set('focus', this.focus);
		if (this.focus && this.depth !== 2) params.set('depth', String(this.depth));
		if (this.hideIsolated) params.set('connected', '1');
		if (this.showGhosts) params.set('ghosts', '1');
		return params;
	}

	applySearchParams(params: URLSearchParams): void {
		const years = params.get('years');
		if (years) this.years = years.split(',').map(Number).filter(Number.isInteger);
		const faculty = params.get('faculty');
		if (faculty) this.faculties = faculty.split(',').filter(Boolean);
		const subject = params.get('subject');
		if (subject) this.subjects = subject.split(',').filter(Boolean);
		const query = params.get('q');
		if (query) this.query = query;
		const focus = params.get('focus');
		if (focus) this.focus = focus;
		const depth = Number(params.get('depth'));
		if (Number.isInteger(depth) && depth >= 1 && depth <= 4) this.depth = depth;
		this.hideIsolated = params.get('connected') === '1';
		this.showGhosts = params.get('ghosts') === '1';
	}
}

export type { CourseAttributes, EdgeAttributes };
