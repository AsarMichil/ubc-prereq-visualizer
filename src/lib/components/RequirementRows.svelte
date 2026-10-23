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
	import type { CreditsOf, RequirementGroup } from '$lib/graph/requirementGroups';
	import { creditsToward, displayGroups, groupSatisfied } from '$lib/graph/requirementGroups';
	import { hopColor, INK, type Theme } from '$lib/graph/palette';
	import RequirementRows from './RequirementRows.svelte';

	let {
		groups,
		drawn,
		picked,
		theme,
		creditsOf,
		onToggle,
		depth = 0
	}: {
		groups: RequirementGroup[];
		drawn: ReadonlySet<string>;
		picked: ReadonlySet<string>;
		theme: Theme;
		/** Credits per course, so a quota row can be checked rather than just shown. */
		creditsOf: CreditsOf;
		onToggle: (code: string) => void;
		depth?: number;
	} = $props();

	const rows = $derived(displayGroups(groups, drawn));

	/**
	 * Courses already drawn count toward a quota exactly as newly ticked ones do -
	 * MATH 200 sitting in the tree satisfies "3 credits of MATH at 200 level or
	 * above" whether or not it was picked in this panel.
	 */
	const selected = $derived(new Set([...picked, ...drawn]));

	/**
	 * Every top-level row has to be met, so a must-have row there needs no
	 * heading - "Required" over a lone course said nothing. Nested inside a
	 * choice it is one option bundling several courses, which is not "required"
	 * at all: it is "all of" these, together.
	 */
	function heading(group: RequirementGroup): string | null {
		if (group.kind === 'choose') return `Choose ${group.n}`;
		return depth === 0 ? null : 'All of';
	}
</script>

<div class="flex flex-col gap-3" class:gap-4={depth === 0}>
	{#each rows as group (group.id)}
		{@const already = group.satisfiedBy.length > 0}
		<!-- `selected` already includes drawn courses, so this covers rows met by
		     the tree. Don't shortcut on `already`: drawn courses meeting *part* of
		     a Required row ("all of A, B, C, D" with D missing) is progress, not ✓. -->
		{@const met = groupSatisfied(group, selected, creditsOf)}
		<!-- A choice holding a nested group gets an "or" between its options:
		     a heading above a run of single courses says "pick one" plainly,
		     but beside a nested "All of" it reads as more of the same list. -->
		{@const divided =
			group.kind === 'choose' && group.visible.some((option) => option.kind === 'compound')}
		<div>
			{#if heading(group)}
				<!-- Nested, the heading lines up with the sibling options' checkboxes:
				     it is one of those options. Only its contents step in. -->
				<p class="mb-1.5 text-[11px] font-semibold tracking-wide uppercase" class:px-2={depth > 0}>
					<span style:color={met ? hopColor(1, theme) : INK[theme].secondary}>
						{heading(group)}
					</span>
					{#if met}<span class="text-[var(--ink-muted)]">· ✓</span>{/if}
				</p>
			{/if}

			<div
				class:ml-3={depth > 0}
				class:border-l-2={depth > 0}
				class:pl-2={depth > 0}
				style:border-color={depth > 0 ? (met ? hopColor(1, theme) : 'var(--line)') : undefined}
			>
				{#if already}
					<p class="px-2 py-1 font-mono text-xs text-[var(--ink-secondary)]">
						{met ? 'Met by' : 'Have'}
						{group.satisfiedBy.join(', ')}
					</p>
				{/if}

				{#if group.unavailable}
					<p class="px-2 py-1 text-xs text-[var(--ink-secondary)] italic">
						Only satisfiable by a UBC Okanagan course, which isn't offered here.
					</p>
				{/if}

				<div class="flex flex-col gap-1">
					{#each group.visible as option, index (option.label + index)}
						{#if divided && index > 0}
							<div
								class="flex items-center gap-2 px-2 py-0.5 text-[11px] text-[var(--ink-muted)]"
								aria-hidden="true"
							>
								<span class="h-px flex-1 bg-[var(--line)]"></span>
								or
								<span class="h-px flex-1 bg-[var(--line)]"></span>
							</div>
						{/if}
						{#if option.kind === 'condition'}
							<p class="px-2 py-1 text-xs text-[var(--ink-secondary)] italic">{option.label}</p>
						{:else if option.kind === 'highSchool'}
							<p class="px-2 py-1 text-xs text-[var(--ink-secondary)]">
								{option.label}
								<span class="text-[var(--ink-muted)]">· high school</span>
							</p>
						{:else if option.kind === 'credits'}
							{@const progress = creditsToward(option, selected, creditsOf)}
							<p class="px-2 py-1 text-xs text-[var(--ink-secondary)]">
								<span class="font-medium">{option.count} credits</span>
								from {option.subjects.join(' or ')}{option.minLevel
									? ` at ${option.minLevel}+`
									: ''}
								<!-- Naming the courses that count is what makes the quota feel
							     selectable: there is no box to tick, so the only feedback is
							     seeing a course you added land against it. -->
								{#if progress.total > 0}
									<span
										style:color={progress.total >= option.count ? hopColor(1, theme) : undefined}
									>
										· {progress.total}/{option.count} from {progress.courses.join(', ')}
									</span>
								{/if}
							</p>
						{:else if option.kind === 'course'}
							<label
								class="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-xs hover:bg-[var(--chip)] md:py-1"
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
							<!-- A nested alternative renders its own rows, indenting below its heading. -->
							<RequirementRows
								groups={[option.group]}
								{drawn}
								{picked}
								{theme}
								{creditsOf}
								{onToggle}
								depth={depth + 1}
							/>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	{/each}
</div>
