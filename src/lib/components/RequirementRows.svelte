<script lang="ts">
	/**
	 * Requirement rows, rendered recursively.
	 *
	 * A nested alternative such as "AI 240 and one of STAT 251, ECON 325, ..." is
	 * a structure, not a sentence. Flattening it into one checkbox label made it
	 * unreadable and - worse - ticking that single box selected all seven courses
	 * inside it, when what you actually need is AI 240 plus exactly one of the six.
	 * Recursing keeps every course an individually selectable leaf.
	 */
	import type { RequirementGroup } from '$lib/graph/requirementGroups';
	import { displayGroups, groupSatisfied } from '$lib/graph/requirementGroups';
	import { hopColor, INK, type Theme } from '$lib/graph/palette';
	import RequirementRows from './RequirementRows.svelte';

	let {
		groups,
		drawn,
		picked,
		theme,
		onToggle,
		depth = 0
	}: {
		groups: RequirementGroup[];
		drawn: ReadonlySet<string>;
		picked: ReadonlySet<string>;
		theme: Theme;
		onToggle: (code: string) => void;
		depth?: number;
	} = $props();

	const rows = $derived(displayGroups(groups, drawn));

	function heading(group: RequirementGroup): string {
		return group.kind === 'required' ? 'Required' : `Choose ${group.n}`;
	}
</script>

<div class="flex flex-col gap-3" class:gap-4={depth === 0}>
	{#each rows as group (group.id)}
		{@const already = group.satisfiedBy.length > 0}
		{@const met = already || groupSatisfied(group, picked as Set<string>)}
		<div>
			<p class="mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
				<span style:color={met ? hopColor(1, theme) : INK[theme].secondary}>
					{heading(group)}
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
						<p class="px-2 py-1 text-xs text-[var(--ink-secondary)] italic">{option.label}</p>
					{:else if option.kind === 'highSchool'}
						<p class="px-2 py-1 text-xs text-[var(--ink-secondary)]">
							{option.label}
							<span class="text-[var(--ink-muted)]">· high school</span>
						</p>
					{:else if option.kind === 'course'}
						<label
							class="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--chip)]"
							title={option.label}
						>
							<input
								type="checkbox"
								class="mt-0.5 shrink-0"
								checked={picked.has(option.code)}
								onchange={() => onToggle(option.code)}
							/>
							<span class="min-w-0 font-mono break-words">{option.label}</span>
						</label>
					{:else}
						<!-- A nested alternative: indent it and render its own rows. -->
						<div
							class="ml-1 border-l-2 pl-2.5"
							style:border-color={groupSatisfied(option.group, picked as Set<string>)
								? hopColor(1, theme)
								: 'var(--line)'}
						>
							<RequirementRows
								groups={[option.group]}
								{drawn}
								{picked}
								{theme}
								{onToggle}
								depth={depth + 1}
							/>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/each}
</div>
