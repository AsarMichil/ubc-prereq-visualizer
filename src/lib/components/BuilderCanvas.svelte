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
	import { createNodeBorderProgram } from '@sigma/node-border';
	import { getBuilder, getExplorer } from '$lib/state/context';
	import { EDGE_COLOR, GHOST_COLOR, INCOMPLETE, INK, SURFACE, yearColor } from '$lib/graph/palette';
	import {
		createEdgeDashedArrowProgram,
		createEdgeDashedSegmentProgram
	} from '$lib/graph/dashedEdge';
	import { makeHoverRenderer } from '$lib/graph/hoverRenderer';
	import { pathLayout } from '$lib/graph/layered';

	const builder = getBuilder();
	const explorer = getExplorer();
	const theme = $derived(explorer.theme);

	/**
	 * A ring drawn as part of the node rather than as an overlay, so it scales
	 * with zoom and stays exactly on the mark. An absolutely-positioned element
	 * floated above the canvas at a fixed pixel size and drifted during movement.
	 */
	const BorderedNode = createNodeBorderProgram({
		borders: [
			{ color: { attribute: 'ringColor' }, size: { attribute: 'ringSize', defaultValue: 0 } },
			{ color: { attribute: 'color' }, size: { fill: true } }
		]
	});

	interface BuilderNode {
		label: string;
		/** Ring marking a course whose prerequisites are unmet. */
		ringColor: string;
		ringSize: number;
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
	/** Cancels the in-flight position animation; see the sync effect. */
	let cancelAnimation: (() => void) | null = null;

	onMount(() => {
		let disposed = false;
		let observer: ResizeObserver | undefined;

		(async () => {
			const { default: SigmaClass } = await import('sigma');
			if (disposed) return;

			renderer = new SigmaClass<BuilderNode>(graph, container, {
				allowInvalidContainer: true,
				defaultNodeType: 'bordered',
				nodeProgramClasses: { bordered: BorderedNode },
				defaultEdgeType: 'arrow',
				edgeProgramClasses: {
					dashedArrow: createEdgeDashedArrowProgram<BuilderNode>(),
					dashedSegment: createEdgeDashedSegmentProgram<BuilderNode>()
				},
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

			// Sigma only re-measures its container on a window resize or a render,
			// so the side panel opening would leave the canvases at their old width,
			// overhanging the panel and swallowing its clicks until something redrew.
			observer = new ResizeObserver(() => renderer?.scheduleRefresh());
			observer.observe(container);

			// Handy for debugging camera and hit-testing from the console.
			if (import.meta.env.DEV) {
				(window as unknown as { __builderSigma?: unknown }).__builderSigma = renderer;
			}

			ready = true;
		})();

		return () => {
			disposed = true;
			observer?.disconnect();
			cancelAnimation?.();
			cancelAnimation = null;
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
	 *
	 * An edge that skips rows is drawn through bend points the layout reserves in
	 * each row it crosses, so it never runs through a course. The bends are
	 * zero-size, unlabelled nodes in this local graph - Sigma draws only straight
	 * segments, and a node is what a segment can end at - and they animate with
	 * everything else. Only the last segment carries the arrow head.
	 */
	$effect(() => {
		const nodes = builder.tiers;
		const links = builder.edges;
		const surplus = builder.surplus;
		const courses = explorer.map?.graph;
		const currentTheme = theme;
		if (!ready || !renderer) return;

		const layout = pathLayout(
			nodes.map((node) => node.code),
			links.map((link) => ({ source: link.from, target: link.to })),
			// Rows sit closer together than columns so the tree reads as tiers
			// rather than as a scattering of points.
			{ nodeWidth: 150, nodeHeight: 40, xGap: 130, yGap: 110 }
		);
		const routes = (link: { from: string; to: string }): string[] =>
			(layout.bends.get(`${link.from}>${link.to}`) ?? []).map((bend) => bend.id);

		const wanted = new Set([
			...nodes.map((node) => node.code),
			...[...layout.bends.values()].flat().map((bend) => bend.id)
		]);
		for (const existing of graph.nodes()) {
			if (!wanted.has(existing)) graph.dropNode(existing);
		}

		for (const node of nodes) {
			// Year level, as on the map: the rows already show distance, so colour
			// is free to say something position does not.
			const course = courses?.hasNode(node.code) ? courses.getNodeAttributes(node.code) : null;
			const colour =
				!course || course.ghost
					? GHOST_COLOR[currentTheme]
					: yearColor(course.number, currentTheme);
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
				ringColor: 'rgba(0,0,0,0)',
				ringSize: 0,
				x: seed.x,
				y: seed.y,
				size: node.tier === 0 ? 16 : 12,
				color: colour,
				tier: node.tier
			});
		}

		// Bends start evenly spaced along the edge's current straight line, so a
		// newly routed edge bends out of where it was rather than from the origin.
		for (const link of links) {
			const bends = routes(link);
			if (!bends.length || !graph.hasNode(link.from) || !graph.hasNode(link.to)) continue;
			const from = graph.getNodeAttributes(link.from);
			const to = graph.getNodeAttributes(link.to);
			bends.forEach((id, index) => {
				if (graph.hasNode(id)) return;
				const t = (index + 1) / (bends.length + 1);
				graph.addNode(id, {
					label: '',
					ringColor: 'rgba(0,0,0,0)',
					ringSize: 0,
					x: from.x + (to.x - from.x) * t,
					y: from.y + (to.y - from.y) * t,
					size: 0,
					color: 'rgba(0,0,0,0)',
					tier: 0
				});
			});
		}

		graph.clearEdges();
		for (const link of links) {
			if (!graph.hasNode(link.from) || !graph.hasNode(link.to)) continue;
			// A prerequisite the course could do without - the second of two
			// alternatives - is drawn dashed, so the tree shows what is actually
			// carrying each requirement.
			const dashed = surplus.has(`${link.from}>${link.to}`);
			const path = [link.from, ...routes(link), link.to];
			for (let index = 1; index < path.length; index++) {
				const last = index === path.length - 1;
				graph.addDirectedEdge(path[index - 1], path[index], {
					type: last ? (dashed ? 'dashedArrow' : 'arrow') : dashed ? 'dashedSegment' : 'line',
					color: EDGE_COLOR[currentTheme],
					size: 4
				});
			}
		}

		const targets: Record<string, { x: number; y: number }> = {};
		for (const [code, point] of layout.positions) targets[code] = point;
		for (const bends of layout.bends.values()) {
			for (const bend of bends) targets[bend.id] = { x: bend.x, y: bend.y };
		}

		// Cancel any animation still running. Adding a course changes the drawn set
		// and then the edges, so this effect fires twice in quick succession; two
		// concurrent animations fight over the same nodes and the older one, headed
		// for stale positions, wins the last write - leaving nodes stacked on their
		// seed position.
		// Cancel any animation still in flight. Adding a course changes the drawn
		// set and then its edges, so this effect fires twice in quick succession,
		// and two animations racing over the same nodes leave them wherever the
		// slower one last wrote.
		cancelAnimation?.();

		// Animation runs on requestAnimationFrame, which is throttled to nothing in
		// a hidden tab - so a layout computed while the tab is in the background
		// would never actually be applied. Place the nodes outright in that case.
		if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
			for (const [code, point] of Object.entries(targets)) {
				graph.mergeNodeAttributes(code, point);
			}
			cancelAnimation = null;
			fit();
			return;
		}

		cancelAnimation = animateNodes(graph, targets, { duration: 420 }, () => {
			cancelAnimation = null;
			fit();
		});
	});

	/** Ring the courses whose prerequisites the drawn set does not satisfy. */
	$effect(() => {
		const unmet = builder.unmet;
		const currentTheme = theme;
		if (!ready || !renderer) return;

		renderer.setSetting('nodeReducer', (code, data) => ({
			...data,
			ringColor: unmet.has(code) ? INCOMPLETE[currentTheme] : 'rgba(0,0,0,0)',
			ringSize: unmet.has(code) ? 0.28 : 0
		}));
		renderer.refresh({ skipIndexation: true });
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

<div class="relative h-full w-full overflow-hidden">
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
