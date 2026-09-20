<script lang="ts">
	/**
	 * Owns the Sigma instance.
	 *
	 * Sigma is imperative and WebGL-backed, so the renderer is held in a plain
	 * `let` — never `$state`. Proxying it would be a real performance trap. A
	 * single $effect pushes filter/focus changes down as reducers; nothing here
	 * ever recomputes positions, because the layout is baked at build time.
	 */
	import { onMount } from 'svelte';
	import { animateNodes } from 'sigma/utils';
	import { layeredLayout } from '$lib/graph/layered';
	import type Sigma from 'sigma';
	import type { CourseAttributes, EdgeAttributes } from '$lib/graph/loadGraph';
	import { getExplorer } from '$lib/state/context';
	import RegionLabels from './RegionLabels.svelte';
	import {
		DIMMED,
		EDGE_COLOR,
		FOCUS_COLORS,
		GHOST_COLOR,
		INK,
		SURFACE,
		yearColor
	} from '$lib/graph/palette';
	import { makeHoverRenderer } from '$lib/graph/hoverRenderer';

	const explorer = getExplorer();

	let container: HTMLDivElement;
	let renderer: Sigma<CourseAttributes, EdgeAttributes> | undefined;
	let ready = $state(false);
	/** Bumped on every camera move so the label overlay re-projects. */
	let viewportVersion = $state(0);

	onMount(() => {
		let disposed = false;

		// Dynamic import: Sigma touches WebGL/window and must not run during SSR.
		(async () => {
			const { default: SigmaClass } = await import('sigma');
			if (disposed || !explorer.map) return;

			renderer = new SigmaClass(explorer.map.graph, container, {
				allowInvalidContainer: true,
				renderEdgeLabels: false,
				enableEdgeEvents: true,
				defaultNodeColor: '#888',
				defaultEdgeColor: '#ccc',
				// Labels are the expensive part; keep them off until a node is big
				// enough on screen to deserve one. This is the "greeking" tier.
				labelRenderedSizeThreshold: 7,
				labelDensity: 0.6,
				labelGridCellSize: 120,
				// Sigma grows nodes as you zoom in (default sqrt), which at focus-level
				// zoom inflated them ~4.5x into overlapping blobs. Cap the growth so a
				// node stays roughly its intended pixel size at any zoom.
				zoomToSizeRatioFunction: (ratio: number) => Math.max(Math.sqrt(ratio), 0.55),
				labelFont: 'ui-monospace, SFMono-Regular, Menlo, monospace',
				labelSize: 12,
				labelWeight: '500',
				// Sigma's default label colour is black, which is unreadable on the
				// dark surface. Always drive it from the theme's ink.
				labelColor: { color: INK[explorer.theme].primary },
				zIndex: true,
				// Sigma's default hover pill is hardcoded white; theme it.
				defaultDrawNodeHover: makeHoverRenderer(explorer.theme)
			});

			renderer.getCamera().on('updated', (state) => {
				explorer.cameraRatio = state.ratio;
				viewportVersion += 1;
			});

			renderer.on('clickNode', ({ node }) => {
				explorer.focus = explorer.focus === node ? null : node;
			});
			renderer.on('clickStage', () => {
				explorer.focus = null;
			});

			// Sigma only normalizes node coordinates during its first refresh. Until
			// that happens getNodeDisplayData returns raw graph coordinates, and
			// feeding those to the camera sends it far outside the scene. Refresh
			// before anything is allowed to read display data.
			renderer.refresh();

			// Handy for debugging layout/camera issues from the console.
			if (import.meta.env.DEV) {
				(window as unknown as { __sigma?: unknown }).__sigma = renderer;
			}

			ready = true;
		})();

		return () => {
			disposed = true;
			renderer?.kill();
			renderer = undefined;
		};
	});

	/**
	 * Reducers run per frame, so they read plain locals captured here rather than
	 * touching reactive state inside the render loop.
	 */
	$effect(() => {
		if (!ready || !renderer || !explorer.map) return;
		const instance = renderer;

		const theme = explorer.theme;
		const visible = explorer.filtered;
		const hasFocus = explorer.hasFocus;
		const neighbourhood = explorer.focusNeighbourhood;
		const focus = explorer.focus;
		const prerequisites = explorer.focusSets.prerequisites;
		const unlocks = explorer.focusSets.unlocks;
		const tier = explorer.tier;

		const dim = DIMMED[theme];
		const ghost = GHOST_COLOR[theme];
		const edgeBase = EDGE_COLOR[theme];
		const focusColors = FOCUS_COLORS[theme];

		instance.setSetting('nodeReducer', (code, data) => {
			const shown = visible.has(code);
			const inFocus = !hasFocus || neighbourhood.has(code);

			// Size carries how many courses depend on this one — a hub reads bigger.
			let size = 2.5 + Math.min(Math.sqrt(data.outDegree) * 1.6, 8);
			let color = data.ghost ? ghost : yearColor(data.number, theme);
			let zIndex = 0;

			if (!shown || !inFocus) {
				return { ...data, size: Math.max(size * 0.55, 1.5), color: dim, label: '', zIndex: -1 };
			}

			if (hasFocus) {
				if (code === focus) {
					color = focusColors.selected;
					size = Math.max(size, 12);
					zIndex = 3;
				} else if (prerequisites.has(code)) {
					color = focusColors.prerequisite;
					size = Math.max(size, 7);
					zIndex = 2;
				} else if (unlocks.has(code)) {
					color = focusColors.unlocks;
					size = Math.max(size, 7);
					zIndex = 2;
				}
			}

			return {
				...data,
				size,
				color,
				zIndex,
				// Far out, nothing gets a label — subject and faculty names are drawn
				// as an overlay instead, so the canvas stays readable when zoomed out.
				label: tier === 'far' && !hasFocus ? '' : data.label
			};
		});

		instance.setSetting('edgeReducer', (_edge, data) => {
			const extremities = instance.getGraph().extremities(_edge);
			const [source, target] = extremities;
			const shown = visible.has(source) && visible.has(target);
			const inFocus = !hasFocus || (neighbourhood.has(source) && neighbourhood.has(target));

			if (!shown || !inFocus || (tier === 'far' && !hasFocus)) {
				return { ...data, hidden: true };
			}

			let color = edgeBase;
			if (hasFocus) {
				if (target === focus || prerequisites.has(target)) color = focusColors.prerequisite;
				else if (source === focus || unlocks.has(source)) color = focusColors.unlocks;
			}

			return {
				...data,
				color,
				size: hasFocus ? 1.6 : 0.7,
				// Alternatives from the same "one of" are drawn dashed as a set.
				type: data.groupId ? 'line' : 'line'
			};
		});

		instance.refresh({ skipIndexation: true });
	});

	$effect(() => {
		const theme = explorer.theme;
		if (container) container.style.background = SURFACE[theme];
		if (ready && renderer) {
			renderer.setSetting('labelColor', { color: INK[theme].primary });
			renderer.setSetting('defaultDrawNodeHover', makeHoverRenderer(theme));
		}
	});

	/**
	 * Frames a set of nodes. Display coordinates live in the camera's own space,
	 * so the bounding box of the selection maps directly onto a camera ratio.
	 */
	function fitTo(ids: Iterable<string>, padding = 1.6): void {
		if (!renderer) return;
		const instance = renderer;

		const measure = () => {
			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;
			let count = 0;

			for (const id of ids) {
				const point = instance.getNodeDisplayData(id);
				if (!point) continue;
				minX = Math.min(minX, point.x);
				maxX = Math.max(maxX, point.x);
				minY = Math.min(minY, point.y);
				maxY = Math.max(maxY, point.y);
				count++;
			}
			return { minX, maxX, minY, maxY, count };
		};

		let { minX, maxX, minY, maxY, count } = measure();

		// Display coordinates are normalized into roughly [0, 1]. Anything well
		// outside that means the cache is still un-normalized, so force a refresh
		// and re-measure rather than steering the camera into empty space.
		const outOfRange = minX < -0.5 || maxX > 1.5 || minY < -0.5 || maxY > 1.5;
		if (count && outOfRange) {
			instance.refresh();
			({ minX, maxX, minY, maxY, count } = measure());
		}
		if (!count) return;

		const ratio = Math.max((maxX - minX) * padding, (maxY - minY) * padding, 0.02);
		instance
			.getCamera()
			.animate(
				{ x: (minX + maxX) / 2, y: (minY + maxY) / 2, ratio: Math.min(ratio, 1) },
				{ duration: 500 }
			);
	}

	/**
	 * "Straighten": rearrange just the focused neighbourhood into a layered chain.
	 *
	 * The baked map is optimised for the whole graph, so an ego network can be
	 * scattered across it and hard to read. This is the one place a live layout is
	 * affordable - a few hundred nodes at most - and it animates back to the baked
	 * coordinates when switched off, so the map never permanently loses its shape.
	 */
	let straightened: Map<string, { x: number; y: number }> | null = null;

	$effect(() => {
		const on = explorer.straighten;
		const nodes = explorer.focusNeighbourhood;
		const focus = explorer.focus;
		if (!ready || !renderer || !explorer.map) return;

		const instance = renderer;
		const graph = explorer.map.graph;

		if (!on || !focus || nodes.size === 0) {
			if (straightened) {
				animateNodes(graph, Object.fromEntries(straightened), { duration: 400 });
				straightened = null;
			}
			return;
		}

		const ids = [...nodes];
		const original = new Map(
			ids.map((id) => {
				const { x, y } = graph.getNodeAttributes(id);
				return [id, { x, y }];
			})
		);

		const edges: { source: string; target: string }[] = [];
		for (const id of ids) {
			for (const neighbour of graph.outNeighbors(id)) {
				if (nodes.has(neighbour)) edges.push({ source: id, target: neighbour });
			}
		}

		// Generous spacing: these nodes carry visible labels, so they need room.
		const result = layeredLayout(
			ids.map((id) => ({ id })),
			edges,
			{ nodeWidth: 300, nodeHeight: 40, xGap: 300, yGap: 260, maxPerRow: 7 }
		);

		// Keep the arrangement centred on where the focus already sits, so the
		// neighbourhood does not fly off to an unrelated part of the map.
		const anchor = original.get(focus)!;
		const focusPoint = result.positions.get(focus) ?? { x: 0, y: 0 };
		const target: Record<string, { x: number; y: number }> = {};
		for (const [id, point] of result.positions) {
			target[id] = {
				x: anchor.x + (point.x - focusPoint.x),
				// The baked map has y flipped for Sigma, so flip the local layout too.
				y: anchor.y - (point.y - focusPoint.y)
			};
		}

		straightened = original;
		animateNodes(graph, target, { duration: 500 }, () => {
			// Full re-index: the nodes just moved, so the normalization Sigma used
			// for the previous layout no longer describes where anything is.
			instance.refresh();
			fitTo(ids);
		});
	});

	/**
	 * Frame the focused neighbourhood whenever the selection changes.
	 *
	 * Two things this must not do, both learned the hard way. It must not read
	 * `explorer.cameraRatio`: moving the camera writes that value back, so the
	 * effect would retrigger itself and the camera would drift forever. And it
	 * must not measure before Sigma's first refresh, because until then display
	 * coordinates are still raw graph units and the camera ends up far outside
	 * the scene. Hence: no camera state in the dependencies, and measure on the
	 * next frame after a synchronous refresh.
	 */
	$effect(() => {
		const focus = explorer.focus;
		const neighbourhood = explorer.focusNeighbourhood;
		const straighten = explorer.straighten;
		if (!ready || !renderer || !focus || !explorer.map?.graph.hasNode(focus)) return;
		if (straighten) return; // the straighten effect frames it instead

		const instance = renderer;
		const frame = requestAnimationFrame(() => {
			instance.refresh({ skipIndexation: true });
			fitTo(neighbourhood.size > 1 ? neighbourhood : [focus], 1.8);
		});
		return () => cancelAnimationFrame(frame);
	});

	/** Projects baked map coordinates into viewport pixels for the label overlay. */
	const project = $derived.by(() => {
		void viewportVersion;
		if (!ready || !renderer) return null;
		const instance = renderer;
		return (point: { x: number; y: number }) => instance.graphToViewport(point);
	});

	export function zoomTo(code: string): void {
		explorer.focus = code;
	}

	export function resetCamera(): void {
		renderer?.getCamera().animate({ x: 0.5, y: 0.5, ratio: 1 }, { duration: 400 });
	}
</script>

<div class="relative h-full w-full">
	<div bind:this={container} class="h-full w-full"></div>

	<RegionLabels {project} />

	{#if !ready}
		<div
			class="pointer-events-none absolute inset-0 grid place-items-center text-sm"
			style="color: {INK[explorer.theme].secondary}"
		>
			Loading the map…
		</div>
	{/if}
</div>
