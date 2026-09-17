<script lang="ts">
	/** Type-ahead over course codes and titles; selecting one focuses the map. */
	import type { ExplorerState } from '$lib/state/explorer.svelte';

	let { explorer }: { explorer: ExplorerState } = $props();

	let term = $state('');
	let open = $state(false);

	const results = $derived.by(() => {
		const graph = explorer.map?.graph;
		const needle = term.trim().toLowerCase();
		if (!graph || needle.length < 2) return [];

		const matches: { code: string; title: string }[] = [];
		graph.forEachNode((code, attributes) => {
			if (matches.length >= 12 || attributes.ghost) return;
			if (
				code.toLowerCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, '')) ||
				attributes.title.toLowerCase().includes(needle)
			) {
				matches.push({ code, title: attributes.title });
			}
		});
		return matches;
	});

	function choose(code: string): void {
		explorer.focus = code;
		term = code;
		open = false;
	}
</script>

<div class="relative">
	<input
		type="search"
		placeholder="Search a course, e.g. CPSC 110"
		class="w-full rounded border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-sm"
		bind:value={term}
		onfocus={() => (open = true)}
		oninput={() => (open = true)}
	/>

	{#if open && results.length}
		<ul
			class="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded border border-[var(--line)] bg-[var(--surface)] shadow-lg"
		>
			{#each results as result (result.code)}
				<li>
					<button
						type="button"
						class="block w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--chip)]"
						onclick={() => choose(result.code)}
					>
						<span class="font-mono font-medium">{result.code}</span>
						<span class="text-[var(--ink-secondary)]"> — {result.title}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
