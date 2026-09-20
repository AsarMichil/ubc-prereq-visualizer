<script lang="ts">
	/**
	 * Filters are visual, not structural: every control here changes how nodes are
	 * painted, never where they sit, so the map never reflows under the user.
	 */
	import { getExplorer } from '$lib/state/context';
	import { YEAR_TIERS, yearSwatches } from '$lib/graph/palette';

	const explorer = getExplorer();

	const swatches = $derived(yearSwatches(explorer.theme));
	const subjects = $derived(explorer.map?.subjects ?? []);

	const visibleSubjects = $derived(
		explorer.faculties.length
			? subjects.filter((s) => s.faculty && explorer.faculties.includes(s.faculty))
			: subjects
	);
</script>

<div class="flex flex-col gap-5 text-sm">
	<section>
		<h3 class="mb-2 text-xs font-semibold tracking-wide uppercase">Year level</h3>
		<div class="flex flex-wrap gap-1.5">
			{#each YEAR_TIERS as label, tier (label)}
				{@const active = explorer.years.includes(tier)}
				<button
					type="button"
					class="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors"
					class:border-transparent={!active}
					style:border-color={active ? swatches[tier].color : 'transparent'}
					style:background={active ? 'var(--chip-active)' : 'var(--chip)'}
					onclick={() => explorer.toggleYear(tier)}
				>
					<span
						class="h-2.5 w-2.5 rounded-full"
						style:background={swatches[tier].color}
						style:opacity={active ? 1 : 0.3}
					></span>
					{label}
				</button>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="mb-2 text-xs font-semibold tracking-wide uppercase">Faculty</h3>
		<div class="flex flex-col gap-1">
			{#each explorer.facultyOptions as faculty (faculty)}
				<label class="flex cursor-pointer items-center gap-2 text-xs">
					<input
						type="checkbox"
						checked={explorer.faculties.includes(faculty)}
						onchange={() => explorer.toggleFaculty(faculty)}
					/>
					<span class="truncate">{faculty.replace(/^Faculty of /, '')}</span>
				</label>
			{/each}
		</div>
	</section>

	<section>
		<h3 class="mb-2 text-xs font-semibold tracking-wide uppercase">Subject</h3>
		<select
			class="w-full rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-xs"
			value={explorer.subjects[0] ?? ''}
			onchange={(event) => explorer.setSubject(event.currentTarget.value || null)}
		>
			<option value="">All subjects ({visibleSubjects.length})</option>
			{#each visibleSubjects as subject (subject.code)}
				<option value={subject.code}>{subject.code} — {subject.title} ({subject.courses})</option>
			{/each}
		</select>
	</section>

	<section class="flex flex-col gap-1.5">
		<label class="flex cursor-pointer items-center gap-2 text-xs">
			<input type="checkbox" bind:checked={explorer.hideIsolated} />
			Only courses with prerequisite links
		</label>
		<label class="flex cursor-pointer items-center gap-2 text-xs">
			<input type="checkbox" bind:checked={explorer.showGhosts} />
			Show courses missing from the calendar
		</label>
	</section>

	{#if explorer.focus}
		<section>
			<h3 class="mb-2 text-xs font-semibold tracking-wide uppercase">Focus depth</h3>
			<input type="range" min="1" max="4" step="1" bind:value={explorer.depth} class="w-full" />
			<p class="mt-1 text-xs text-[var(--ink-secondary)]">
				{explorer.depth} hop{explorer.depth === 1 ? '' : 's'} from {explorer.focus}
			</p>
			<label class="mt-2 flex cursor-pointer items-center gap-2 text-xs">
				<input type="checkbox" bind:checked={explorer.straighten} />
				Straighten into a chain
			</label>
		</section>
	{/if}

	<button
		type="button"
		class="self-start rounded border border-[var(--line)] px-2.5 py-1 text-xs hover:bg-[var(--chip)]"
		onclick={() => explorer.reset()}>Reset filters</button
	>
</div>
