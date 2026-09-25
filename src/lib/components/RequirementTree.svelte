<script lang="ts">
	/** Renders a requirement AST as a nested, readable list. */
	import type { RequirementNode } from '$lib/types';
	import RequirementTree from './RequirementTree.svelte';

	let { node, onSelect }: { node: RequirementNode | null; onSelect?: (code: string) => void } =
		$props();

	const LABELS: Record<string, string> = {
		standing: 'Standing',
		program: 'Program',
		permission: 'Permission',
		credits: 'Credits',
		other: 'Also'
	};
</script>

{#if node}
	{#if node.kind === 'course'}
		<button
			type="button"
			class="rounded px-1.5 py-0.5 font-mono text-xs underline decoration-dotted underline-offset-2 hover:bg-[var(--chip)]"
			onclick={() => onSelect?.(node.code)}>{node.code}</button
		>
	{:else if node.kind === 'highSchoolCourse'}
		<span class="rounded bg-[var(--chip)] px-1.5 py-0.5 text-xs">
			{node.name}
			<span class="text-[var(--ink-muted)]">· high school</span>
		</span>
	{:else if node.kind === 'condition'}
		<span class="text-xs text-[var(--ink-secondary)]">
			<span class="font-medium">{LABELS[node.conditionType] ?? 'Also'}:</span>
			{node.raw}
		</span>
	{:else if node.kind === 'credits'}
		<span class="text-xs text-[var(--ink-secondary)]">
			<span class="font-medium">{node.count} credits</span>
			from {node.subjects.join(' or ')}{node.minLevel ? ` at ${node.minLevel}+` : ''}
		</span>
	{:else if node.kind === 'unparsed'}
		<span class="text-xs text-[var(--ink-secondary)] italic">{node.raw}</span>
	{:else if node.kind === 'withGrade'}
		<span class="text-xs">
			<span class="font-medium">at least {node.min}% in</span>
		</span>
		<div class="mt-1 ml-3">
			<RequirementTree node={node.child} {onSelect} />
		</div>
	{:else}
		{@const heading =
			node.kind === 'all' ? 'All of' : node.kind === 'oneOf' ? 'One of' : `${node.n} of`}
		<div class="text-xs">
			<span class="font-medium text-[var(--ink-secondary)]">{heading}</span>
			<ul class="mt-1 ml-3 space-y-1 border-l border-[var(--line)] pl-3">
				{#each node.children as child, index (index)}
					<li><RequirementTree node={child} {onSelect} /></li>
				{/each}
			</ul>
		</div>
	{/if}
{/if}
