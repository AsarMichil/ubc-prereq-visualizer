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
	import { loadMap } from '$lib/graph/loadGraph';
	import { ExplorerState } from '$lib/state/explorer.svelte';
	import { FOCUS_COLORS, yearSwatches, type Theme } from '$lib/graph/palette';

	const explorer = new ExplorerState();
	const builder = new PathBuilderState();

	/**
	 * Two ways in. `explore` is the whole map - every course at once, for seeing
	 * how the curriculum hangs together. `build` draws only what you choose,
	 * growing outward from one course in either direction.
	 */
	let mode = $state<'explore' | 'build'>('explore');

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

		loadMap()
			.then((map) => {
				explorer.map = map;
				builder.attach(map.graph);
			})
			.catch((cause) => (error = cause instanceof Error ? cause.message : String(cause)));

		return () => media.removeEventListener('change', onThemeChange);
	});

	// Keep the URL in step with the view so any state is shareable.
	$effect(() => {
		if (!explorer.map) return;
		const query = explorer.toSearchParams().toString();
		if (query === page.url.search.replace(/^\?/, '')) return;
		replaceState(query ? resolve(`/?${query}`) : resolve('/'), {});
	});

	/**
	 * Searching in build mode adds to what is already drawn rather than replacing
	 * it. A course that relates to something on screen joins that component; one
	 * that doesn't starts its own. An already-drawn course just opens its panel.
	 */
	$effect(() => {
		if (mode !== 'build') return;
		builder.syncFocus(explorer.focus);
	});

	const swatches = $derived(yearSwatches(explorer.theme));
	const focusColors = $derived(FOCUS_COLORS[explorer.theme]);
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
		<button
			type="button"
			class="rounded border border-[var(--line)] px-2 py-1 text-xs hover:bg-[var(--chip)]"
			onclick={() => (panelOpen = !panelOpen)}
			aria-expanded={panelOpen}
			disabled={mode === 'build'}
			class:opacity-40={mode === 'build'}>{panelOpen ? '‹' : '›'} Filters</button
		>

		<h1 class="text-sm font-semibold whitespace-nowrap">UBC Prerequisites</h1>

		<div class="flex rounded border border-[var(--line)] p-0.5 text-xs">
			{#each [['explore', 'Explore'], ['build', 'Build a path']] as [value, label] (value)}
				<button
					type="button"
					class="rounded px-2.5 py-1"
					style:background={mode === value ? 'var(--chip-active)' : 'transparent'}
					aria-pressed={mode === value}
					onclick={() => (mode = value as 'explore' | 'build')}>{label}</button
				>
			{/each}
		</div>

		<div class="max-w-md flex-1"><SearchBox {explorer} /></div>

		{#if mode === 'build' && !builder.isEmpty}
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
			<div class="hidden items-center gap-2 lg:flex" class:invisible={mode === 'build'}>
				{#each swatches as swatch (swatch.label)}
					<span class="flex items-center gap-1">
						<span class="h-2.5 w-2.5 rounded-full" style:background={swatch.color}></span>
						{swatch.label}
					</span>
				{/each}
			</div>
			<span class="tabular-nums"
				>{visibleCount.toLocaleString()} / {nodeCount.toLocaleString()}</span
			>
		</div>
	</header>

	<div class="flex min-h-0 flex-1">
		{#if panelOpen && mode === 'explore'}
			<aside
				class="w-64 shrink-0 overflow-y-auto border-r border-[var(--line)] bg-[var(--surface)] p-4"
			>
				<FilterPanel {explorer} />
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
			{:else if explorer.map && mode === 'build'}
				<PathBuilder {builder} {explorer} />
			{:else if explorer.map}
				<GraphCanvas {explorer} />

				{#if explorer.hasFocus}
					<div
						class="pointer-events-none absolute bottom-3 left-3 flex gap-3 rounded border border-[var(--line)] bg-[var(--surface)]/90 px-3 py-1.5 text-xs"
					>
						<span class="flex items-center gap-1.5">
							<span class="h-2.5 w-2.5 rounded-full" style:background={focusColors.prerequisite}
							></span>needs
						</span>
						<span class="flex items-center gap-1.5">
							<span class="h-2.5 w-2.5 rounded-full" style:background={focusColors.unlocks}
							></span>unlocks
						</span>
					</div>
				{/if}
			{:else}
				<div class="grid h-full place-items-center text-sm text-[var(--ink-secondary)]">
					Loading {nodeCount ? '' : 'the map'}…
				</div>
			{/if}
		</main>

		{#if mode === 'explore'}
			<CourseDetail {explorer} />
		{/if}
	</div>
</div>
