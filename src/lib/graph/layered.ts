/**
 * Sugiyama-style layered layout for prerequisite DAGs.
 *
 * Hand-written rather than pulled from a library for two reasons: elkjs does
 * not load under Bun (its CommonJS worker shim resolves to undefined, and
 * requiring the worker directly hangs), and the same implementation is needed
 * on both sides — the build script bakes the map with it, and the client uses
 * it to "straighten" a focused ego network on demand.
 *
 * Prerequisite edges point from the required course to the course that requires
 * it, so layer 0 holds courses with no prerequisites and y grows with depth.
 */

export interface LayoutNode {
	id: string;
}

export interface LayoutEdge {
	/** The prerequisite. */
	source: string;
	/** The course that depends on it. */
	target: string;
}

export interface LayeredOptions {
	nodeWidth?: number;
	nodeHeight?: number;
	xGap?: number;
	yGap?: number;
	/** Barycentre passes. Two is usually enough; more has diminishing returns. */
	sweeps?: number;
	/**
	 * Maximum nodes in one visual row. A hub like MATH 102 unlocks 37 courses,
	 * which as a single layer is an unreadable ribbon wider than any screen, so
	 * oversized layers wrap onto stacked sub-rows instead.
	 */
	maxPerRow?: number;
}

export interface LayeredResult {
	positions: Map<string, { x: number; y: number }>;
	width: number;
	height: number;
	layerCount: number;
}

const DEFAULTS = { nodeWidth: 160, nodeHeight: 40, xGap: 90, yGap: 150, sweeps: 4, maxPerRow: 10 };

/**
 * Longest-path layering. Nodes left over after Kahn's algorithm are in a cycle
 * (a parse bug, or a genuine mutual corequisite); they are placed one level
 * below their deepest resolved predecessor rather than dropped.
 */
function assignLayers(
	ids: string[],
	incoming: Map<string, string[]>,
	outgoing: Map<string, string[]>
): Map<string, number> {
	const layer = new Map<string, number>();
	const remaining = new Map<string, number>();
	const queue: string[] = [];

	for (const id of ids) {
		const degree = incoming.get(id)?.length ?? 0;
		remaining.set(id, degree);
		if (degree === 0) {
			layer.set(id, 0);
			queue.push(id);
		}
	}

	while (queue.length) {
		const id = queue.shift()!;
		for (const next of outgoing.get(id) ?? []) {
			layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
			const left = (remaining.get(next) ?? 1) - 1;
			remaining.set(next, left);
			if (left === 0) queue.push(next);
		}
	}

	// Anything still unlayered sits on a cycle.
	for (const id of ids) {
		if (layer.has(id)) continue;
		const depths = (incoming.get(id) ?? [])
			.map((from) => layer.get(from))
			.filter((v) => v !== undefined);
		layer.set(id, depths.length ? Math.max(...(depths as number[])) + 1 : 0);
	}

	return layer;
}

/** Mean position of a node's neighbours in an adjacent layer, or null if it has none. */
function barycentre(neighbours: string[] | undefined, indexOf: Map<string, number>): number | null {
	if (!neighbours?.length) return null;
	const known = neighbours.map((id) => indexOf.get(id)).filter((v): v is number => v !== undefined);
	if (!known.length) return null;
	return known.reduce((sum, value) => sum + value, 0) / known.length;
}

export function layeredLayout(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	options: LayeredOptions = {}
): LayeredResult {
	const { nodeWidth, nodeHeight, xGap, yGap, sweeps, maxPerRow } = { ...DEFAULTS, ...options };

	const ids = nodes.map((node) => node.id);
	const present = new Set(ids);
	const incoming = new Map<string, string[]>();
	const outgoing = new Map<string, string[]>();

	for (const edge of edges) {
		if (!present.has(edge.source) || !present.has(edge.target) || edge.source === edge.target)
			continue;
		(outgoing.get(edge.source) ?? outgoing.set(edge.source, []).get(edge.source)!).push(
			edge.target
		);
		(incoming.get(edge.target) ?? incoming.set(edge.target, []).get(edge.target)!).push(
			edge.source
		);
	}

	const layer = assignLayers(ids, incoming, outgoing);

	const layers: string[][] = [];
	for (const id of ids) {
		const index = layer.get(id) ?? 0;
		(layers[index] ??= []).push(id);
	}
	for (const row of layers) if (row) row.sort();

	// Barycentre sweeps: alternate downward and upward so ordering information
	// propagates in both directions and edge crossings settle.
	const indexOf = new Map<string, number>();
	const reindex = () => {
		indexOf.clear();
		for (const row of layers) row?.forEach((id, index) => indexOf.set(id, index));
	};
	reindex();

	for (let sweep = 0; sweep < sweeps; sweep++) {
		const downward = sweep % 2 === 0;
		const order = downward ? [...layers.keys()] : [...layers.keys()].reverse();

		for (const index of order) {
			const row = layers[index];
			if (!row || row.length < 2) continue;

			const scored = row.map((id, position) => ({
				id,
				score: barycentre(downward ? incoming.get(id) : outgoing.get(id), indexOf) ?? position
			}));
			scored.sort((a, b) => a.score - b.score);
			layers[index] = scored.map((entry) => entry.id);
		}
		reindex();
	}

	const stepX = nodeWidth + xGap;
	const stepY = nodeHeight + yGap;

	// Expand each layer into one or more rows of at most maxPerRow nodes.
	const rows: string[][] = [];
	const rowOfLayer: number[] = [];
	layers.forEach((layer, index) => {
		rowOfLayer[index] = rows.length;
		if (!layer?.length) return;
		for (let start = 0; start < layer.length; start += maxPerRow) {
			rows.push(layer.slice(start, start + maxPerRow));
		}
	});

	const widest = Math.max(1, ...rows.map((row) => row.length));
	const positions = new Map<string, { x: number; y: number }>();

	rows.forEach((row, index) => {
		const offset = ((widest - row.length) * stepX) / 2;
		row.forEach((id, position) => {
			positions.set(id, { x: offset + position * stepX, y: index * stepY });
		});
	});

	void rowOfLayer;

	return {
		positions,
		width: widest * stepX,
		height: Math.max(1, rows.length) * stepY,
		layerCount: rows.length
	};
}

/**
 * Places nodes with no edges in a compact grid. They are real courses and belong
 * on the map, but running them through the layered pass would produce one
 * enormously wide row that dwarfs the connected structure.
 */
export function gridLayout(
	ids: string[],
	options: {
		columns?: number;
		nodeWidth?: number;
		nodeHeight?: number;
		xGap?: number;
		yGap?: number;
	} = {}
): LayeredResult {
	const nodeWidth = options.nodeWidth ?? DEFAULTS.nodeWidth;
	const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
	const xGap = options.xGap ?? DEFAULTS.xGap;
	// Grids are dense by nature, so they get a little less vertical gap than the
	// layered blocks - but still enough that rows read as rows.
	const yGap = options.yGap ?? 80;
	const columns = options.columns ?? Math.max(1, Math.ceil(Math.sqrt(ids.length * 1.6)));

	const stepX = nodeWidth + xGap;
	const stepY = nodeHeight + yGap;
	const positions = new Map<string, { x: number; y: number }>();

	ids.forEach((id, index) => {
		positions.set(id, {
			x: (index % columns) * stepX,
			y: Math.floor(index / columns) * stepY
		});
	});

	return {
		positions,
		width: Math.min(ids.length, columns) * stepX,
		height: Math.ceil(ids.length / columns) * stepY,
		layerCount: Math.ceil(ids.length / columns)
	};
}

export interface TieredNode {
	id: string;
	/** Signed hop distance; higher values sit higher on screen. */
	tier: number;
}

/**
 * Positions nodes whose rows are already decided.
 *
 * `layeredLayout` derives layers from the edges, which is right for a subject
 * subgraph. The path builder already knows each node's row - it is the hop
 * distance from the course you started at - so the tiers are given here and only
 * the horizontal order is solved, using the same barycentre sweeps to keep edges
 * from crossing.
 */
export function tieredLayout(
	nodes: TieredNode[],
	edges: LayoutEdge[],
	options: LayeredOptions = {}
): LayeredResult {
	const { nodeWidth, nodeHeight, xGap, yGap, sweeps } = { ...DEFAULTS, ...options };

	const present = new Set(nodes.map((node) => node.id));
	const neighbours = new Map<string, string[]>();
	const link = (a: string, b: string) =>
		(neighbours.get(a) ?? neighbours.set(a, []).get(a)!).push(b);

	for (const edge of edges) {
		if (!present.has(edge.source) || !present.has(edge.target)) continue;
		link(edge.source, edge.target);
		link(edge.target, edge.source);
	}

	// Lowest tier first: prerequisites sit above the courses that need them, so
	// the view reads top to bottom as early work down to final-year work.
	const byTier = new Map<number, string[]>();
	for (const node of nodes) {
		(byTier.get(node.tier) ?? byTier.set(node.tier, []).get(node.tier)!).push(node.id);
	}
	const rows = [...byTier.entries()].sort((a, b) => a[0] - b[0]).map(([, ids]) => ids.sort());

	const indexOf = new Map<string, number>();
	const reindex = () => {
		indexOf.clear();
		for (const row of rows) row.forEach((id, index) => indexOf.set(id, index));
	};
	reindex();

	// Order within each row to reduce edge crossings.
	for (let sweep = 0; sweep < sweeps; sweep++) {
		for (const row of rows) {
			if (row.length < 2) continue;
			const scored = row.map((id, position) => ({
				id,
				score: barycentre(neighbours.get(id), indexOf) ?? position
			}));
			scored.sort((a, b) => a.score - b.score);
			row.splice(0, row.length, ...scored.map((entry) => entry.id));
		}
		reindex();
	}

	const stepX = nodeWidth + xGap;
	const stepY = nodeHeight + yGap;

	/**
	 * Horizontal placement.
	 *
	 * Spacing each row evenly and centring it independently pushed a course away
	 * from its own prerequisite whenever the two rows differed in width - MATH 100
	 * and MATH 101 could end up at opposite ends of the view. Each node is now
	 * pulled toward the median x of the courses it connects to.
	 *
	 * The passes alternate direction - one considering only what a course
	 * requires, the next only what requires it. Pulling both ways at once makes
	 * neighbours chase each other and collapse onto a single column, or oscillate
	 * between two arrangements and never settle.
	 *
	 * After each pull the row is separated to keep a minimum gap, then shifted so
	 * its centre returns to where the pull wanted it. That gap is the tolerance:
	 * courses sit as close to their requirements as they can without overlapping.
	 */
	const predecessors = new Map<string, string[]>();
	const successors = new Map<string, string[]>();
	for (const edge of edges) {
		if (!present.has(edge.source) || !present.has(edge.target)) continue;
		(predecessors.get(edge.target) ?? predecessors.set(edge.target, []).get(edge.target)!).push(
			edge.source
		);
		(successors.get(edge.source) ?? successors.set(edge.source, []).get(edge.source)!).push(
			edge.target
		);
	}

	const x = new Map<string, number>();
	for (const row of rows) row.forEach((id, index) => x.set(id, index * stepX));

	const median = (values: number[]): number => {
		const sorted = [...values].sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);
		return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
	};

	for (let pass = 0; pass < 8; pass++) {
		const downward = pass % 2 === 0;
		const anchors = downward ? predecessors : successors;
		const order = downward ? rows : [...rows].reverse();

		for (const row of order) {
			const desired = row.map((id) => {
				const linked = (anchors.get(id) ?? [])
					.map((other) => x.get(other))
					.filter((value): value is number => value !== undefined);
				return linked.length ? median(linked) : x.get(id)!;
			});

			row.forEach((id, index) => x.set(id, desired[index]));

			// Separate, preserving the crossing-minimised order.
			for (let i = 1; i < row.length; i++) {
				const left = x.get(row[i - 1])!;
				if (x.get(row[i])! < left + stepX) x.set(row[i], left + stepX);
			}
			for (let i = row.length - 2; i >= 0; i--) {
				const right = x.get(row[i + 1])!;
				if (x.get(row[i])! > right - stepX) x.set(row[i], right - stepX);
			}

			// Return the row's centre to where the pull asked for it.
			if (row.length) {
				const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
				const shift = mean(desired) - mean(row.map((id) => x.get(id)!));
				for (const id of row) x.set(id, x.get(id)! + shift);
			}
		}
	}

	const allX = [...x.values()];
	const minX = allX.length ? Math.min(...allX) : 0;
	const maxX = allX.length ? Math.max(...allX) : 0;

	const positions = new Map<string, { x: number; y: number }>();
	rows.forEach((row, index) => {
		for (const id of row) {
			positions.set(id, { x: x.get(id)! - minX, y: index * stepY });
		}
	});

	return {
		positions,
		width: Math.max(maxX - minX + stepX, stepX),
		height: Math.max(1, rows.length) * stepY,
		layerCount: rows.length
	};
}
