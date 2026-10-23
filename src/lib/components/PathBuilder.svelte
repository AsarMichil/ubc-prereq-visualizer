<script lang="ts">
	/**
	 * The path builder: a graph of only the courses you have chosen to draw.
	 *
	 * The canvas is the same Sigma renderer the map uses, so both modes look and
	 * handle alike. Per-node controls live in this panel rather than on the marks,
	 * which is what lets the view stay a real graph instead of a list of chips.
	 */
	import { resolve } from '$app/paths';
	import { MediaQuery } from 'svelte/reactivity';
	import type { Direction } from '$lib/state/pathBuilder.svelte';
	import { getBuilder, getExplorer } from '$lib/state/context';
	import { displayGroups, groupSatisfied } from '$lib/graph/requirementGroups';
	import BuilderCanvas from './BuilderCanvas.svelte';
	import RequirementRows from './RequirementRows.svelte';
	import { EDGE_COLOR, INCOMPLETE, INK, yearSwatches } from '$lib/graph/palette';
	import { flags } from '$lib/flags.svelte';

	const builder = getBuilder();
	const explorer = getExplorer();

	/** Candidate codes ticked in the open panel, not yet added to the tree. */
	let picked = $state<string[]>([]);
	let forwardFilter = $state('');

	const theme = $derived(explorer.theme);
	const swatches = $derived(yearSwatches(theme));

	const expandingNode = $derived(builder.expanding);

	/**
	 * Legend keys only for marks actually on screen: on a phone the legend shares
	 * the canvas, and a key for something not drawn is a question with no answer.
	 */
	const alternatives = $derived(flags.enabled('junctions') ? builder.alternatives : []);
	const dashedShown = $derived.by(() => {
		const joined = new Set(
			alternatives.flatMap((set) => set.from.map((code) => `${code}>${set.to}`))
		);
		return [...builder.surplus].some((key) => !joined.has(key));
	});

	/** Below `md` the panel is a modal over the canvas rather than a sidebar. */
	const small = new MediaQuery('max-width: 767px');

	function close(): void {
		builder.expanding = null;
	}

	const visibleForward = $derived.by(() => {
		const needle = forwardFilter.trim().toLowerCase();
		if (!needle) return builder.forward;
		return builder.forward.filter(
			(candidate) =>
				candidate.code.toLowerCase().includes(needle) ||
				candidate.title.toLowerCase().includes(needle)
		);
	});

	function toggle(code: string): void {
		picked = picked.includes(code) ? picked.filter((c) => c !== code) : [...picked, code];
	}

	function openPanel(code: string, direction: Direction): void {
		picked = [];
		forwardFilter = '';
		void builder.expand(code, direction);
	}

	function commit(): void {
		if (!expandingNode || picked.length === 0) return;
		builder.add(expandingNode.code, picked, expandingNode.direction);
		picked = [];
	}

	/** Already-drawn courses can't be picked again. */
	function selectable(code: string): boolean {
		return !builder.has(code);
	}

	const pickedSet = $derived(new Set(picked));

	/**
	 * Options already drawn, or that cannot be taken here at all, are removed
	 * rather than shown disabled - the builder's whole premise is that only what
	 * you chose stays on screen.
	 */
	const drawn = $derived(new Set(builder.codes));
	const rowsToShow = $derived(displayGroups(builder.groups, drawn));

	/** A row is met once your picks, or what is already drawn, satisfy it. */
	const unmetGroups = $derived(
		rowsToShow.filter(
			(group) =>
				group.satisfiedBy.length === 0 &&
				!group.unavailable &&
				!groupSatisfied(group, pickedSet, builder.creditsOf)
		)
	);
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === 'Escape' && small.current && expandingNode) close();
	}}
/>

<div class="flex h-full min-h-0">
	<div class="relative min-w-0 flex-1">
		{#if builder.isEmpty}
			<div class="grid h-full place-items-center p-8 text-center">
				<div class="max-w-sm">
					<h2 class="text-base font-semibold">Build a path</h2>
					<p class="mt-2 text-sm text-[var(--ink-secondary)]">
						Search for a course above, then expand it toward what it requires or what it unlocks.
						Only what you pick gets drawn.
					</p>
					<!--
						The one place every user passes through, so the caveat goes here rather
						than only behind a link nobody clicks. Kept to one line; the reasoning
						is on /about.
					-->
					<p class="mt-6 text-xs text-[var(--ink-muted)]">
						Not affiliated with UBC, and not guaranteed accurate — check the Calendar before you
						register. <a href={resolve('/about')} class="underline underline-offset-2">More</a>
					</p>
				</div>
			</div>
		{:else}
			<BuilderCanvas />
		{/if}

		<!--
			Legend: colour is year level, as on the map. The edge keys come first
			because none of them is guessable: which way an arrow runs, what the "or"
			joining two lines means, a dashed edge (which could as easily mean
			"optional"), and the ring.
		-->
		{#if !builder.isEmpty}
			<div
				class="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded border border-[var(--line)] bg-[var(--surface)]/90 px-3 py-1.5 text-[11px] md:left-6"
			>
				{#if builder.edges.length > 0}
					<!--
						A grid rather than a wrapping row: the marks share one column, centred,
						so every description starts at the same x however the keys wrap.
					-->
					<div class="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 leading-4">
						<span class="flex items-center justify-center gap-1 font-mono font-medium">
							A
							<svg width="22" height="8" aria-hidden="true">
								<line x1="0" y1="4" x2="16" y2="4" stroke={EDGE_COLOR[theme]} stroke-width="2" />
								<path d="M15 0.5 L22 4 L15 7.5 Z" fill={EDGE_COLOR[theme]} />
							</svg>
							B
						</span>
						<span class="text-[var(--ink-secondary)]">A is required for B</span>
						{#if alternatives.length > 0}
							<span class="flex justify-center">
								<span
									class="flex h-[15px] items-center rounded-full border-[1.5px] px-1.5 pt-px font-mono text-[10px] leading-none"
									style:border-color={EDGE_COLOR[theme]}
									style:color={INK[theme].secondary}>or</span
								>
							</span>
							<span class="text-[var(--ink-secondary)]">Any one of them is enough</span>
						{/if}
						{#if dashedShown}
							<span class="flex justify-center">
								<svg width="22" height="4" aria-hidden="true">
									<line
										x1="0"
										y1="2"
										x2="22"
										y2="2"
										stroke={EDGE_COLOR[theme]}
										stroke-width="2.5"
										stroke-dasharray="5 4"
									/>
								</svg>
							</span>
							<span class="text-[var(--ink-secondary)]">Extra option</span>
						{/if}
						{#if builder.unmet.size > 0}
							<span class="flex justify-center">
								<span
									class="h-2.5 w-2.5 rounded-full border-2"
									style:border-color={INCOMPLETE[theme]}
								></span>
							</span>
							<span class="text-[var(--ink-secondary)]">Needs more</span>
						{/if}
					</div>
				{/if}
				<div
					class="flex flex-wrap gap-x-3 gap-y-1 leading-4"
					class:border-t={builder.edges.length > 0}
					class:pt-1.5={builder.edges.length > 0}
					class:mt-0.5={builder.edges.length > 0}
					style:border-color="var(--line)"
				>
					{#each swatches as swatch (swatch.label)}
						<span class="flex items-center gap-1.5">
							<span class="h-2.5 w-2.5 rounded-full" style:background={swatch.color}></span>
							{swatch.label}
						</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	<!--
		The candidate panel: a sidebar from md up, a modal below that. Adding courses
		closes it (see `builder.add`), so on a phone you land back on the graph.
	-->
	{#if expandingNode}
		<!-- The keyboard route out is Escape, handled on the window above. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-30 bg-black/50 md:hidden" onclick={close}></div>
		<aside
			role={small.current ? 'dialog' : undefined}
			aria-modal={small.current ? 'true' : undefined}
			aria-label={small.current ? expandingNode.code : undefined}
			class="fixed inset-3 z-40 m-auto flex h-fit max-h-[calc(100dvh-1.5rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-2xl md:static md:inset-auto md:z-auto md:m-0 md:h-auto md:max-h-none md:w-[24rem] md:shrink-0 md:rounded-none md:border-0 md:border-l md:shadow-none"
		>
			<div class="flex items-start justify-between gap-2">
				<h2 class="font-mono text-sm font-semibold">{expandingNode.code}</h2>
				<div class="flex items-center gap-1">
					<button
						type="button"
						title="Remove this course, and anything left stranded by it"
						class="rounded px-2.5 py-2 text-xs text-[var(--ink-secondary)] hover:bg-[var(--chip)] md:px-2 md:py-1"
						onclick={() => builder.remove(expandingNode.code)}>Remove</button
					>
					<button
						type="button"
						class="rounded px-2.5 py-2 text-xs text-[var(--ink-secondary)] hover:bg-[var(--chip)] md:px-2 md:py-1"
						onclick={close}>Close</button
					>
				</div>
			</div>

			<!-- Both directions are one click away; expanding is the whole interaction. -->
			<div class="mt-3 flex rounded border border-[var(--line)] p-0.5 text-xs">
				{#each [['back', 'Requires'], ['forward', 'Unlocks']] as [value, label] (value)}
					<button
						type="button"
						class="flex-1 rounded px-2 py-2 md:py-1"
						style:background={expandingNode.direction === value
							? 'var(--chip-active)'
							: 'transparent'}
						aria-pressed={expandingNode.direction === value}
						onclick={() => openPanel(expandingNode.code, value as Direction)}>{label}</button
					>
				{/each}
			</div>

			{#if builder.loading}
				<p class="mt-4 text-xs text-[var(--ink-muted)]">Loading…</p>
			{:else if expandingNode.direction === 'back'}
				{#if builder.groups.length === 0}
					<p class="mt-4 rounded bg-[var(--chip)] p-3 text-xs text-[var(--ink-secondary)]">
						No prerequisites — this is an entry point.
					</p>
				{:else}
					<div class="mt-4">
						<RequirementRows
							groups={builder.groups}
							{drawn}
							picked={pickedSet}
							{theme}
							creditsOf={builder.creditsOf}
							onToggle={toggle}
						/>
					</div>
				{/if}
			{:else if builder.forward.length === 0}
				<p class="mt-4 rounded bg-[var(--chip)] p-3 text-xs text-[var(--ink-secondary)]">
					Nothing lists this course as a prerequisite.
				</p>
			{:else}
				<p class="mt-4 text-xs text-[var(--ink-secondary)]">
					{builder.forward.length} courses list {expandingNode.code} as a prerequisite. Nothing here is
					required — pick the ones worth drawing.
				</p>
				<input
					type="search"
					placeholder="Filter…"
					class="mt-2 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-base md:text-xs"
					bind:value={forwardFilter}
				/>
				<div class="mt-2 flex flex-col gap-0.5">
					{#each visibleForward as candidate (candidate.code)}
						{@const already = !selectable(candidate.code)}
						<label
							class="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs hover:bg-[var(--chip)] md:py-1"
							class:opacity-50={already}
						>
							<input
								type="checkbox"
								class="mt-0.5"
								disabled={already}
								checked={pickedSet.has(candidate.code)}
								onchange={() => toggle(candidate.code)}
							/>
							<span class="min-w-0">
								<span class="font-mono font-medium">{candidate.code}</span>
								<span class="text-[var(--ink-secondary)]"> {candidate.title}</span>
								{#if candidate.unlocks > 0}
									<span class="text-[var(--ink-muted)]"> · opens {candidate.unlocks}</span>
								{/if}
							</span>
						</label>
					{/each}
				</div>
			{/if}

			{#if !builder.loading && (builder.groups.length > 0 || builder.forward.length > 0)}
				<!-- Sticky, so a long list never scrolls the button out of reach. -->
				<div
					class="sticky -bottom-4 -mx-4 mt-4 -mb-4 flex items-center gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-4 pt-3 pb-4"
				>
					<button
						type="button"
						class="rounded bg-[var(--chip-active)] px-3 py-2 text-xs font-medium disabled:opacity-40 md:py-1.5"
						disabled={picked.length === 0}
						onclick={commit}
					>
						Add {picked.length || ''}
						{picked.length === 1 ? 'course' : 'courses'}
					</button>
					{#if expandingNode.direction === 'back' && unmetGroups.length > 0}
						<span class="text-[11px] text-[var(--ink-muted)]">
							{unmetGroups.length} row{unmetGroups.length === 1 ? '' : 's'} still unmet
						</span>
					{/if}
				</div>
			{/if}
		</aside>
	{/if}
</div>
