<script lang="ts">
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import GraphCanvas from '$lib/components/GraphCanvas.svelte';
	import FilterPanel from '$lib/components/FilterPanel.svelte';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import CourseDetail from '$lib/components/CourseDetail.svelte';
	import PathBuilder from '$lib/components/PathBuilder.svelte';
	import { PathBuilderState } from '$lib/state/pathBuilder.svelte';
	import { setBuilder, setExplorer } from '$lib/state/context';
	import { flags } from '$lib/flags.svelte';
	import { loadMap } from '$lib/graph/loadGraph';
	import { ExplorerState } from '$lib/state/explorer.svelte';
	import { yearSwatches, type Theme } from '$lib/graph/palette';
	import { startSession, track } from '$lib/analytics';

	const explorer = new ExplorerState();
	const builder = new PathBuilderState(track);

	// Shared through context rather than threaded down as props.
	setExplorer(explorer);
	setBuilder(builder);

	/**
	 * Two ways in. `explore` is the whole map - every course at once, for seeing
	 * how the curriculum hangs together. `build` draws only what you choose,
	 * growing outward from one course in either direction.
	 */
	let mode = $state<'explore' | 'build'>('explore');

	/**
	 * Explore is behind a flag while it is still rough; building a path is not.
	 *
	 * `mode` holds what was last asked for and `activeMode` what is actually
	 * shown, so turning the flag on in the console switches straight to the view
	 * without a reload, and turning it off falls back instead of rendering a
	 * view that is meant to be hidden.
	 */
	const exploreEnabled = $derived(flags.enabled('explore'));
	const activeMode = $derived(mode === 'explore' && !exploreEnabled ? 'build' : mode);

	let error = $state<string | null>(null);
	let panelOpen = $state(true);

	function currentTheme(): Theme {
		const stamped = document.documentElement.dataset.theme;
		if (stamped === 'dark' || stamped === 'light') return stamped;
		return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}

	onMount(() => {
		explorer.theme = currentTheme();
		explorer.applySearchParams(new URLSearchParams(page.url.search));

		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const onThemeChange = () => (explorer.theme = currentTheme());
		media.addEventListener('change', onThemeChange);

		// The builder lives here, so the session that reports what was built does
		// too. No-op unless the Supabase keys are set - see $lib/analytics.
		const endSession = startSession(() => builder.summary());

		loadMap()
			.then((map) => {
				explorer.map = map;
				builder.attach(map.graph);
			})
			.catch((cause) => {
				error = cause instanceof Error ? cause.message : String(cause);
				// Worth watching in the first weeks: this is ~7MB over whatever
				// connection a student happens to be on.
				track('map_load_failed', { message: error });
			});

		return () => {
			media.removeEventListener('change', onThemeChange);
			endSession();
		};
	});

	// Keep the URL in step with the view so any state is shareable.
	$effect(() => {
		if (!explorer.map) return;
		const query = explorer.toSearchParams().toString();
		if (query === page.url.search.replace(/^\?/, '')) return;
		replaceState(query ? resolve(`/?${query}`) : resolve('/'), {});
	});

	/**
	 * A course was chosen. Called from the interaction that caused it rather than
	 * from an effect watching `explorer.focus` - an effect there also depended on
	 * the builder's drawn set, so removing a course re-ran it and put the course
	 * straight back.
	 *
	 * In build mode the choice adds to what is drawn: a course related to
	 * something on screen joins that component, one that isn't starts its own.
	 */
	function selectCourse(code: string): void {
		// The chosen code only - never what was typed to find it.
		track('search_select', { code, mode: activeMode });
		if (activeMode === 'build') builder.select(code);
		else explorer.focus = code;
	}

	function setMode(next: 'explore' | 'build'): void {
		if (next === 'explore' && !exploreEnabled) return;
		mode = next;
		// Carry a course chosen on the map over into the builder.
		if (next === 'build' && explorer.focus && !builder.has(explorer.focus)) {
			builder.select(explorer.focus);
		}
	}

	const swatches = $derived(yearSwatches(explorer.theme));
	const nodeCount = $derived(explorer.map?.payload.nodes.length ?? 0);
	const visibleCount = $derived(explorer.filtered.size);
</script>

<svelte:head>
	<title>UBC Course Prerequisite Map</title>
	<meta
		name="description"
		content="An explorable map of every course prerequisite at UBC Vancouver."
	/>
</svelte:head>

<div class="flex h-screen w-screen flex-col overflow-hidden">
	<header class="flex items-center gap-4 border-b border-[var(--line)] px-4 py-2.5">
		{#if exploreEnabled}
			<button
				type="button"
				class="rounded border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--chip)]"
				onclick={() => (panelOpen = !panelOpen)}
				aria-expanded={panelOpen}
				disabled={activeMode === 'build'}
				class:opacity-40={activeMode === 'build'}>{panelOpen ? '‹' : '›'} Filters</button
			>
		{/if}

		<h1 class="text-sm font-semibold whitespace-nowrap">UBC Prerequisites</h1>

		{#if exploreEnabled}
			<div class="flex rounded border border-[var(--line)] p-0.5 text-xs">
				{#each [['explore', 'Explore'], ['build', 'Build a path']] as [value, label] (value)}
					<button
						type="button"
						class="rounded px-2.5 py-1"
						style:background={activeMode === value ? 'var(--chip-active)' : 'transparent'}
						aria-pressed={activeMode === value}
						onclick={() => setMode(value as 'explore' | 'build')}>{label}</button
					>
				{/each}
			</div>
		{/if}

		<div class="max-w-md flex-1"><SearchBox onSelect={selectCourse} /></div>

		{#if activeMode === 'build' && !builder.isEmpty}
			<button
				type="button"
				class="rounded border border-[var(--line)] px-2.5 py-1 text-xs whitespace-nowrap hover:bg-[var(--chip)]"
				onclick={() => {
					builder.clear();
					explorer.focus = null;
				}}
			>
				Clear {builder.codes.length}
			</button>
		{/if}

		<div class="ml-auto flex items-center gap-4 text-xs text-[var(--ink-secondary)]">
			<!-- Legend: identity is never colour alone, so the swatches are labelled. -->
			<div class="hidden items-center gap-2 lg:flex" class:invisible={activeMode === 'build'}>
				{#each swatches as swatch (swatch.label)}
					<span class="flex items-center gap-1">
						<span class="h-2.5 w-2.5 rounded-full" style:background={swatch.color}></span>
						{swatch.label}
					</span>
				{/each}
			</div>
			<!-- A filtered-of-total count only means something next to the filters. -->
			{#if activeMode === 'explore'}
				<span class="tabular-nums"
					>{visibleCount.toLocaleString()} / {nodeCount.toLocaleString()}</span
				>
			{/if}
			<a href={resolve('/about')} class="text-[var(--ink-muted)] hover:underline">About</a>
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		{#if panelOpen && activeMode === 'explore'}
			<aside
				class="w-64 shrink-0 overflow-y-auto border-r border-[var(--line)] bg-[var(--surface)] p-4"
			>
				<FilterPanel />
			</aside>
		{/if}

		<main class="relative min-w-0 flex-1">
			{#if error}
				<div class="grid h-full place-items-center p-8 text-center text-sm">
					<div>
						<p class="font-medium">Could not load the map.</p>
						<p class="mt-1 text-[var(--ink-secondary)]">{error}</p>
						<p class="mt-3 text-xs text-[var(--ink-muted)]">
							Run <code class="font-mono">bun run build:data</code> to generate static/data.
						</p>
					</div>
				</div>
			{:else if explorer.map && activeMode === 'build'}
				<PathBuilder />
			{:else if explorer.map}
				<GraphCanvas />
			{:else}
				<div class="grid h-full place-items-center text-sm text-[var(--ink-secondary)]">
					Loading {nodeCount ? '' : 'the map'}…
				</div>
			{/if}
		</main>

		{#if activeMode === 'explore'}
			<CourseDetail />
		{/if}
	</div>
</div>
