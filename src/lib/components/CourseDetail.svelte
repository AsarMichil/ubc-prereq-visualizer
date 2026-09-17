<script lang="ts">
	/**
	 * Detail panel for the focused course. Per-subject detail is fetched lazily —
	 * it is far too large to ship with the map payload — and cached per subject.
	 */
	import type { ExplorerState } from '$lib/state/explorer.svelte';
	import type { RequirementNode } from '$lib/types';
	import RequirementTree from './RequirementTree.svelte';

	let { explorer }: { explorer: ExplorerState } = $props();

	interface CourseDetailPayload {
		title: string;
		description: string;
		hours: string | null;
		credits: { min: number; max: number };
		prerequisite: RequirementNode | null;
		corequisite: RequirementNode | null;
		notes: string[];
		equivalentTo: string[];
		creditExcludedWith: string[];
		url: string;
	}

	// Deliberately a plain Map: this is a module-level fetch cache, not UI state.
	// Making it reactive would invalidate every reader on each subject load.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const cache = new Map<string, Record<string, CourseDetailPayload>>();
	let detail = $state<CourseDetailPayload | null>(null);
	let loading = $state(false);

	async function subjectBundle(subject: string) {
		const cached = cache.get(subject);
		if (cached) return cached;
		const response = await fetch(`/data/courses/${subject}.json`);
		const bundle = (await response.json()) as Record<string, CourseDetailPayload>;
		cache.set(subject, bundle);
		return bundle;
	}

	$effect(() => {
		const code = explorer.focus;
		const graph = explorer.map?.graph;
		if (!code || !graph?.hasNode(code)) {
			detail = null;
			return;
		}

		const attributes = graph.getNodeAttributes(code);
		if (attributes.ghost) {
			detail = null;
			return;
		}

		let cancelled = false;
		loading = true;
		subjectBundle(attributes.subject)
			.then((bundle) => {
				if (!cancelled) detail = bundle[code] ?? null;
			})
			.finally(() => {
				if (!cancelled) loading = false;
			});

		return () => {
			cancelled = true;
		};
	});

	const attributes = $derived(
		explorer.focus && explorer.map?.graph.hasNode(explorer.focus)
			? explorer.map.graph.getNodeAttributes(explorer.focus)
			: null
	);

	function credits(range: { min: number; max: number }): string {
		return range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`;
	}
</script>

{#if attributes}
	<aside
		class="flex h-full w-[22rem] shrink-0 flex-col overflow-y-auto border-l border-[var(--line)] bg-[var(--surface)] p-4"
	>
		<div class="flex items-start justify-between gap-2">
			<div>
				<h2 class="font-mono text-base font-semibold">{explorer.focus}</h2>
				<p class="text-sm text-[var(--ink-secondary)]">{attributes.title || '—'}</p>
			</div>
			<button
				type="button"
				class="rounded px-2 py-1 text-xs text-[var(--ink-secondary)] hover:bg-[var(--chip)]"
				onclick={() => (explorer.focus = null)}>Close</button
			>
		</div>

		{#if attributes.ghost}
			<p class="mt-4 rounded bg-[var(--chip)] p-3 text-xs text-[var(--ink-secondary)]">
				Referenced as a prerequisite but not listed in the current calendar
				{attributes.otherCampus ? ' — this is a UBC Okanagan course.' : '.'}
			</p>
		{:else}
			<dl class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-secondary)]">
				<div>
					<dt class="inline font-medium">Subject</dt>
					<dd class="inline">{attributes.subject}</dd>
				</div>
				{#if detail}
					<div>
						<dt class="inline font-medium">Credits</dt>
						<dd class="inline">{credits(detail.credits)}</dd>
					</div>
				{/if}
				{#if detail?.hours}
					<div>
						<dt class="inline font-medium">Hours</dt>
						<dd class="inline">{detail.hours}</dd>
					</div>
				{/if}
			</dl>

			<div class="mt-3 flex gap-3 text-xs">
				<span class="text-[var(--ink-secondary)]">
					<strong class="text-[var(--ink-primary)]">{attributes.inDegree}</strong> prerequisite links
				</span>
				<span class="text-[var(--ink-secondary)]">
					unlocks <strong class="text-[var(--ink-primary)]">{attributes.outDegree}</strong>
				</span>
			</div>

			{#if loading && !detail}
				<p class="mt-4 text-xs text-[var(--ink-muted)]">Loading details…</p>
			{:else if detail}
				{#if detail.description}
					<p class="mt-4 text-sm leading-relaxed">{detail.description}</p>
				{/if}

				{#if detail.prerequisite}
					<section class="mt-4">
						<h3 class="text-xs font-semibold tracking-wide uppercase">Prerequisites</h3>
						<div class="mt-2">
							<RequirementTree
								node={detail.prerequisite}
								onSelect={(code) => (explorer.focus = code)}
							/>
						</div>
					</section>
				{/if}

				{#if detail.corequisite}
					<section class="mt-4">
						<h3 class="text-xs font-semibold tracking-wide uppercase">Corequisites</h3>
						<div class="mt-2">
							<RequirementTree
								node={detail.corequisite}
								onSelect={(code) => (explorer.focus = code)}
							/>
						</div>
					</section>
				{/if}

				{#if detail.equivalentTo.length || detail.creditExcludedWith.length}
					<section class="mt-4">
						<h3 class="text-xs font-semibold tracking-wide uppercase">Equivalent / excluded</h3>
						<p class="mt-2 font-mono text-xs text-[var(--ink-secondary)]">
							{[...new Set([...detail.equivalentTo, ...detail.creditExcludedWith])].join(', ')}
						</p>
					</section>
				{/if}

				{#if detail.notes.length}
					<section class="mt-4">
						<h3 class="text-xs font-semibold tracking-wide uppercase">Notes</h3>
						<ul class="mt-2 space-y-1 text-xs text-[var(--ink-secondary)]">
							{#each detail.notes as note (note)}<li>{note}</li>{/each}
						</ul>
					</section>
				{/if}

				{#if detail.url}
					<a
						class="mt-5 text-xs underline underline-offset-2 hover:no-underline"
						href={detail.url}
						target="_blank"
						rel="noreferrer external">View in the UBC Calendar →</a
					>
				{/if}
			{/if}
		{/if}
	</aside>
{/if}
