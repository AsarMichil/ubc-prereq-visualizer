<script lang="ts">
	/**
	 * The path builder's canvas.
	 *
	 * Uses the same Sigma renderer as the map so the two modes look and handle
	 * alike - same node marks, same colours, same pan and zoom. Only the contents
	 * differ: this graph holds just the courses you have chosen to draw, and its
	 * positions come from a tier layout rather than the baked map coordinates.
	 *
	 * Node controls live in the side panel rather than on the marks themselves;
	 * that is what makes a canvas viable here at all.
	 */
	import { onMount } from 'svelte';
	import Graph from 'graphology';
	import type Sigma from 'sigma';
	import { animateNodes } from 'sigma/utils';
	import type { PathBuilderState } from '$lib/state/pathBuilder.svelte';
	import type { Theme } from '$lib/graph/palette';
	import { EDGE_COLOR, hopColor, INK, SURFACE } from '$lib/graph/palette';
	import { makeHoverRenderer } from '$lib/graph/hoverRenderer';
	import { tieredLayout } from '$lib/graph/layered';

	let { builder, theme }: { builder: PathBuilderState; theme: Theme } = $props();

	interface BuilderNode {
		label: string;
		x: number;
		y: number;
		size: number;
		color: string;
		tier: number;
	}

	let container: HTMLDivElement;
	let renderer: Sigma<BuilderNode> | undefined;
	let graph = new Graph<BuilderNode>({ type: 'directed' });
	let ready = $state(false);

	onMount(() => {
		let disposed = false;

		(async () => {
			const { default: SigmaClass } = await import('sigma');
			if (disposed) return;

			renderer = new SigmaClass<BuilderNode>(graph, container, {
				allowInvalidContainer: true,
				defaultEdgeType: 'arrow',
				renderEdgeLabels: false,
				labelFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
				labelSize: 13,
				labelWeight: '500',
				labelColor: { color: INK[theme].primary },
				// Every drawn course is deliberately chosen, so all of them keep a
				// label - unlike the map, nothing here is background texture.
				labelRenderedSizeThreshold: 0,
				labelDensity: 1,
				zoomToSizeRatioFunction: (ratio: number) => Math.max(Math.sqrt(ratio), 0.55),
				defaultDrawNodeHover: makeHoverRenderer(theme)
			});

			renderer.on('clickNode', ({ node }) => void builder.expand(node, 'back'));

			ready = true;
		})();

		return () => {
			disposed = true;
			renderer?.kill();
			renderer = undefined;
		};
	});

	/**
	 * Frames every drawn node.
	 *
	 * The refresh must re-index: this runs right after `animateNodes` has moved
	 * every node, and skipping indexation would leave Sigma's normalization based
	 * on the previous positions, framing the camera on coordinates that no longer
	 * exist.
	 */
	function fit(): void {
		if (!renderer || graph.order === 0) return;
		const instance = renderer;
		instance.refresh();

		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		graph.forEachNode((node) => {
			const point = instance.getNodeDisplayData(node);
			if (!point) return;
			minX = Math.min(minX, point.x);
			maxX = Math.max(maxX, point.x);
			minY = Math.min(minY, point.y);
			maxY = Math.max(maxY, point.y);
		});
		if (!Number.isFinite(minX)) return;

		// Sigma normalizes to the graph's own bounding box, so "fit" always fills the
		// viewport no matter how little is drawn - three nodes end up flung into the
		// corners with enormous edges between them. Zoom out further the fewer nodes
		// there are, so a small tree reads as a compact cluster and a large one still
		// uses the space.
		const span = Math.max(maxX - minX, maxY - minY, 0.05);
		const padding = Math.min(Math.max(3.4 - graph.order * 0.22, 1.3), 3.2);
		const ratio = Math.min(span * padding, 4);
		instance
			.getCamera()
			.animate({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio }, { duration: 420 });
	}

	/**
	 * Syncs the graph to the chosen set, then animates nodes into their rows.
	 *
	 * New nodes are seeded at the position of the node they were expanded from, so
	 * the tree visibly grows outward from where you clicked instead of appearing
	 * somewhere unrelated.
	 */
	$effect(() => {
		const nodes = builder.tiers;
		const links = builder.edges;
		const currentTheme = theme;
		if (!ready || !renderer) return;

		const wanted = new Set(nodes.map((node) => node.code));
		for (const existing of graph.nodes()) {
			if (!wanted.has(existing)) graph.dropNode(existing);
		}

		for (const node of nodes) {
			const colour = hopColor(node.tier, currentTheme);
			if (graph.hasNode(node.code)) {
				graph.mergeNodeAttributes(node.code, { color: colour, tier: node.tier });
				continue;
			}
			// Grow outward from whichever drawn course this one connects to, so a new
			// node appears beside its relation rather than flying in from the origin.
			const anchor = links.find(
				(link) =>
					(link.to === node.code && graph.hasNode(link.from)) ||
					(link.from === node.code && graph.hasNode(link.to))
			);
			const anchorCode = anchor ? (anchor.to === node.code ? anchor.from : anchor.to) : null;
			const seed = anchorCode ? graph.getNodeAttributes(anchorCode) : { x: 0, y: 0 };
			graph.addNode(node.code, {
				label: node.code,
				x: seed.x,
				y: seed.y,
				size: node.tier === 0 ? 16 : 12,
				color: colour,
				tier: node.tier
			});
		}

		graph.clearEdges();
		for (const link of links) {
			if (graph.hasNode(link.from) && graph.hasNode(link.to)) {
				graph.addDirectedEdge(link.from, link.to, {
					color: EDGE_COLOR[currentTheme],
					size: 4
				});
			}
		}

		const layout = tieredLayout(
			nodes.map((node) => ({ id: node.code, tier: node.tier })),
			links.map((link) => ({ source: link.from, target: link.to })),
			// Rows sit closer together than columns so the tree reads as tiers
			// rather than as a scattering of points.
			{ nodeWidth: 150, nodeHeight: 40, xGap: 130, yGap: 110 }
		);

		const targets: Record<string, { x: number; y: number }> = {};
		for (const [code, point] of layout.positions) targets[code] = point;

		animateNodes(graph, targets, { duration: 420 }, fit);
	});

	$effect(() => {
		const currentTheme = theme;
		if (container) container.style.background = SURFACE[currentTheme];
		if (ready && renderer) {
			renderer.setSetting('labelColor', { color: INK[currentTheme].primary });
			renderer.setSetting('defaultDrawNodeHover', makeHoverRenderer(currentTheme));
		}
	});
</script>

<div class="relative h-full w-full">
	<div bind:this={container} class="h-full w-full"></div>

	{#if builder.codes.length <= 1}
		<p
			class="pointer-events-none absolute inset-x-0 bottom-10 text-center text-xs"
			style:color={INK[theme].secondary}
		>
			Click a course to see what it requires, or use the panel to expand it either way.
		</p>
	{/if}
</div>
