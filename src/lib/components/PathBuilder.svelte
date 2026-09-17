<script lang="ts">
	/**
	 * The path builder: a graph of only the courses you have chosen to draw.
	 *
	 * The canvas is the same Sigma renderer the map uses, so both modes look and
	 * handle alike. Per-node controls live in this panel rather than on the marks,
	 * which is what lets the view stay a real graph instead of a list of chips.
	 */
	import type { PathBuilderState, Direction } from '$lib/state/pathBuilder.svelte';
	import type { ExplorerState } from '$lib/state/explorer.svelte';
	import { displayGroups, groupSatisfied } from '$lib/graph/requirementGroups';
	import BuilderCanvas from './BuilderCanvas.svelte';
	import { hopColor, hopSwatches, INK } from '$lib/graph/palette';

	let { builder, explorer }: { builder: PathBuilderState; explorer: ExplorerState } = $props();

	/** Candidate codes ticked in the open panel, not yet added to the tree. */
	let picked = $state<string[]>([]);
	let forwardFilter = $state('');

	const theme = $derived(explorer.theme);
	const swatches = $derived(hopSwatches(theme));

	const expandingNode = $derived(builder.expanding);

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
	const drawn = $derived(new Set(builder.nodes.map((node) => node.code)));
	const rowsToShow = $derived(displayGroups(builder.groups, drawn));

	/** A row is met once your picks, or what is already drawn, satisfy it. */
	const unmetGroups = $derived(
		rowsToShow.filter(
			(group) =>
				group.satisfiedBy.length === 0 && !group.unavailable && !groupSatisfied(group, pickedSet)
		)
	);
</script>

<div class="flex h-full min-h-0">
	<div class="relative min-w-0 flex-1">
		{#if !builder.root}
			<div class="grid h-full place-items-center p-8 text-center">
				<div class="max-w-sm">
					<h2 class="text-base font-semibold">Build a path</h2>
					<p class="mt-2 text-sm text-[var(--ink-secondary)]">
						Search for a course above, then expand it toward what it requires or what it unlocks.
						Only what you pick gets drawn.
					</p>
				</div>
			</div>
		{:else}
			<BuilderCanvas {builder} {theme} />
		{/if}
	</div>

	<!-- The candidate panel -->
	{#if expandingNode}
		<aside
			class="flex w-[24rem] shrink-0 flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] p-4"
		>
			<div class="flex items-start justify-between gap-2">
				<h2 class="font-mono text-sm font-semibold">{expandingNode.code}</h2>
				<div class="flex items-center gap-1">
					{#if expandingNode.code !== builder.root}
						<button
							type="button"
							title="Remove this course and everything beyond it"
							class="rounded px-2 py-1 text-xs text-[var(--ink-secondary)] hover:bg-[var(--chip)]"
							onclick={() => builder.remove(expandingNode.code)}>Remove</button
						>
					{/if}
					<button
						type="button"
						class="rounded px-2 py-1 text-xs text-[var(--ink-secondary)] hover:bg-[var(--chip)]"
						onclick={() => (builder.expanding = null)}>Close</button
					>
				</div>
			</div>

			<!-- Both directions are one click away; expanding is the whole interaction. -->
			<div class="mt-3 flex rounded border border-[var(--line)] p-0.5 text-xs">
				{#each [['back', 'Requires'], ['forward', 'Unlocks']] as [value, label] (value)}
					<button
						type="button"
						class="flex-1 rounded px-2 py-1"
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
					<div class="mt-4 flex flex-col gap-4">
						{#each rowsToShow as group (group.id)}
							{@const already = group.satisfiedBy.length > 0}
							{@const met = already || groupSatisfied(group, pickedSet)}
							<div>
								<p class="mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
									<span style:color={met ? hopColor(1, theme) : INK[theme].secondary}>
										{group.kind === 'required' ? 'Required' : `Choose ${group.n}`}
									</span>
									{#if met}<span class="text-[var(--ink-muted)]">· ✓</span>{/if}
								</p>

								{#if already}
									<p class="px-2 py-1 font-mono text-xs text-[var(--ink-secondary)]">
										Met by {group.satisfiedBy.join(', ')}
									</p>
								{/if}

								{#if group.unavailable}
									<p class="px-2 py-1 text-xs text-[var(--ink-secondary)] italic">
										Only satisfiable by a UBC Okanagan course, which isn't offered here.
									</p>
								{/if}

								<div class="flex flex-col gap-1">
									{#each group.visible as option, index (option.label + index)}
										{#if option.kind === 'condition'}
											<p class="px-2 py-1 text-xs text-[var(--ink-secondary)] italic">
												{option.label}
											</p>
										{:else if option.kind === 'highSchool'}
											<p class="px-2 py-1 text-xs text-[var(--ink-secondary)]">
												{option.label}
												<span class="text-[var(--ink-muted)]">· high school</span>
											</p>
										{:else}
											{@const codes = option.kind === 'course' ? [option.code] : option.courses}
											<label
												class="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--chip)]"
												title={option.label}
											>
												<input
													type="checkbox"
													class="mt-0.5 shrink-0"
													checked={codes.some((c) => pickedSet.has(c))}
													onchange={() => codes.forEach((c) => selectable(c) && toggle(c))}
												/>
												<!-- UBC writes some requirements as one long run-on clause;
												     clamp it and keep the full text in the tooltip. -->
												<span class="line-clamp-2 min-w-0 font-mono break-words"
													>{option.label}</span
												>
											</label>
										{/if}
									{/each}
								</div>
							</div>
						{/each}
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
					class="mt-2 w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-xs"
					bind:value={forwardFilter}
				/>
				<div class="mt-2 flex flex-col gap-0.5">
					{#each visibleForward as candidate (candidate.code)}
						{@const already = !selectable(candidate.code)}
						<label
							class="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--chip)]"
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
				<div class="mt-4 flex items-center gap-2 border-t border-[var(--line)] pt-3">
					<button
						type="button"
						class="rounded bg-[var(--chip-active)] px-3 py-1.5 text-xs font-medium disabled:opacity-40"
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

<!-- Legend: colour means hop distance here, not year level. -->
{#if builder.root}
	<div
		class="pointer-events-none absolute bottom-3 left-6 flex gap-3 rounded border border-[var(--line)] bg-[var(--surface)]/90 px-3 py-1.5 text-[11px]"
	>
		{#each swatches as swatch (swatch.label)}
			<span class="flex items-center gap-1.5">
				<span class="h-2.5 w-2.5 rounded-full" style:background={swatch.color}></span>
				{swatch.label}
			</span>
		{/each}
	</div>
{/if}
