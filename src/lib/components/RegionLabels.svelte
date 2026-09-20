<script lang="ts">
	/**
	 * Faculty and subject names drawn as an HTML overlay above the canvas.
	 *
	 * This is the level-of-detail tier that makes zooming out meaningful: far out
	 * you read faculties, mid-zoom you read subjects, and only close in do
	 * individual course labels (drawn by Sigma itself) appear. It also carries the
	 * faculty identity that colour deliberately does not.
	 */
	import { getExplorer } from '$lib/state/context';

	let {
		project
	}: {
		/** Maps baked map coordinates to viewport pixels. */
		project: ((point: { x: number; y: number }) => { x: number; y: number }) | null;
	} = $props();

	const explorer = getExplorer();

	interface Region {
		key: string;
		label: string;
		x: number;
		y: number;
		emphasis: boolean;
	}

	const regions = $derived.by<Region[]>(() => {
		const map = explorer.map;
		if (!map || !project) return [];

		const active = explorer.faculties;
		const tier = explorer.tier;

		if (tier === 'near') return [];

		if (tier === 'far') {
			// In the relatedness layout the regions are communities, named after the
			// subjects that dominate them; in the faculty layout they are faculties.
			if (explorer.layout === 'related') {
				// Only the substantial clusters get a name, and it sits above the
				// cluster rather than over it: centred labels are wider than the gaps
				// between clusters, so they overlapped their neighbours.
				return map.payload.communities
					.filter((community) => community.size >= 60)
					.sort((a, b) => b.size - a.size)
					.slice(0, 16)
					.map((community) => ({
						key: `c${community.id}`,
						label: community.label,
						...project({ x: community.x, y: -community.y - community.radius * 1.12 }),
						emphasis: true
					}));
			}

			return map.payload.facultyBoxes.map((box) => ({
				key: box.name,
				label: box.name.replace(/^Faculty of /, ''),
				...project({ x: box.x, y: -box.y }),
				emphasis: !active.length || active.includes(box.name)
			}));
		}

		// Mid zoom: name the subjects. Only meaningful in the faculty layout, where
		// a subject occupies one contiguous block.
		if (explorer.layout === 'related') return [];

		return map.subjects
			.filter((subject) => subject.courses >= 6)
			.map((subject) => ({
				key: subject.code,
				label: subject.code,
				...project({ x: subject.x, y: -subject.y }),
				emphasis:
					(!active.length || (subject.faculty ? active.includes(subject.faculty) : false)) &&
					(!explorer.subjects.length || explorer.subjects.includes(subject.code))
			}));
	});
</script>

<div class="pointer-events-none absolute inset-0 overflow-hidden">
	{#each regions as region (region.key)}
		<span
			class="absolute -translate-x-1/2 -translate-y-1/2 font-semibold whitespace-nowrap transition-opacity"
			class:text-sm={explorer.tier === 'far'}
			class:text-xs={explorer.tier !== 'far'}
			class:tracking-wide={explorer.tier === 'far'}
			style:left="{region.x}px"
			style:top="{region.y}px"
			style:opacity={region.emphasis ? (explorer.tier === 'far' ? 0.85 : 0.6) : 0.18}
			style:color="var(--ink-primary)"
			style:text-shadow="0 0 6px var(--surface), 0 0 12px var(--surface)"
		>
			{region.label}
		</span>
	{/each}
</div>
