/**
 * The force layout: courses positioned by simulating the prerequisite graph
 * rather than by arranging it.
 *
 * The relatedness layout (clusterLayout.ts) detects communities and then *draws*
 * them - a phyllotaxis spiral per community, ordered by degree, shelf-packed
 * across the canvas. That makes the community structure legible, but within a
 * community the positions carry no information: MATH 200 and MATH 221 sit
 * wherever the spiral happens to put them, however tightly they are linked.
 *
 * ForceAtlas2 instead lets the edges decide. Strongly tied courses end up
 * adjacent because the edges pull them together, so distance becomes
 * meaningful at every scale, not just between communities.
 *
 * Three settings do the real work:
 *
 * - **LinLog mode** makes attraction logarithmic in distance, which sharpens
 *   the gap between clusters instead of packing everything into one ball. It is
 *   what turns a hairball into separated groups.
 * - **Outbound attraction distribution** divides a node's pull by its degree,
 *   so a hub like MATH 100 - a prerequisite for hundreds of courses - stops
 *   dragging the entire graph onto itself and sits at the centre of its own
 *   neighbourhood instead.
 * - **Intra-community edge weights** bias the simulation toward the Louvain
 *   communities the relatedness layout already found, so the two views tell a
 *   consistent story rather than disagreeing about what belongs together.
 *
 * Isolated courses take no part: two thirds of the corpus has no prerequisite
 * edge, and a node with no edges feels only repulsion, so the simulation would
 * fling it to the rim and crush everything else into the middle. They are placed
 * afterwards, in orbit around whichever community their subject belongs to.
 *
 * Some communities are isolated *entirely* - ASIA's 233 courses and ARTH's 107
 * have no prerequisite edges between them at all - so there is no simulated
 * position to orbit. Those get their own places in a belt outside the simulated
 * cloud, which is both honest about having no structural signal and better than
 * the alternative: defaulting to the origin dropped 1,481 courses on top of the
 * busiest part of the map.
 */
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import { dominantCommunityBySubject } from './clusterLayout.ts';

export interface ForceLayoutInput {
	/** Every course code to place, connected or not. */
	codes: string[];
	/** Prerequisite edges as [prerequisite, dependent]. */
	edges: [string, string][];
	subjectOf: Map<string, string>;
	/** Structural communities, for edge weighting and seeding. */
	communityOf: Map<string, number>;
	/**
	 * Every course's community, including edge-less ones filed under their
	 * subject. Needed because the relatedness layout mints ids for subjects with
	 * no connected course at all, and re-deriving them here would put the two
	 * layouts' communities out of step - a label would then point at nothing.
	 */
	assignedCommunity: Map<string, number>;
}

export interface ForceLayoutResult {
	positions: Map<string, { x: number; y: number }>;
	/** Where each community settled, so its label can be placed clear of it. */
	communities: Map<number, { x: number; y: number; radius: number }>;
	/** Mean edge length within a community vs. across two - the separation the
	 *  simulation achieved. Reported at build time so a regression is visible. */
	quality: { intra: number; inter: number; ratio: number };
}

/** Iterations. Past ~500 the arrangement stops changing perceptibly. */
const ITERATIONS = 600;

/**
 * How much harder an edge inside a community pulls than one across two.
 * High enough to bias the result toward the detected communities, low enough
 * that a genuine cross-community tie still shortens the distance.
 */
const INTRA_COMMUNITY_WEIGHT = 3;

const NODE_GAP = 190;

/** Deterministic RNG: the layout is committed, so a rebuild must reproduce it. */
function seededRandom(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) & 0x7fffffff;
		return state / 0x7fffffff;
	};
}

/** Phyllotaxis spiral: even, gap-free packing that reads as a round cluster. */
function spiral(count: number, gap: number): { x: number; y: number }[] {
	const points: { x: number; y: number }[] = [];
	const golden = Math.PI * (3 - Math.sqrt(5));
	for (let i = 0; i < count; i++) {
		const radius = gap * Math.sqrt(i + 0.5);
		const angle = i * golden;
		points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
	}
	return points;
}

export function forceLayout(input: ForceLayoutInput): ForceLayoutResult {
	const { codes, edges, subjectOf, communityOf, assignedCommunity } = input;
	const present = new Set(codes);
	const random = seededRandom(0xf02ce);

	// --- 1. The connected subgraph ------------------------------------------
	// Undirected: for "what sits near what", a prerequisite is a tie either way.
	const graph = new Graph({ type: 'undirected' });
	for (const [from, to] of edges) {
		if (!present.has(from) || !present.has(to) || from === to) continue;
		if (!graph.hasNode(from)) graph.addNode(from, { x: 0, y: 0 });
		if (!graph.hasNode(to)) graph.addNode(to, { x: 0, y: 0 });

		const sameCommunity = communityOf.has(from) && communityOf.get(from) === communityOf.get(to);
		graph.mergeEdge(from, to, { weight: sameCommunity ? INTRA_COMMUNITY_WEIGHT : 1 });
	}

	// --- 2. Seed from the community structure -------------------------------
	// ForceAtlas2 is a local optimiser: it refines the arrangement it starts
	// from and cannot move a cluster past another one. Seeding at random would
	// leave communities interleaved no matter how long it runs, so each starts
	// as a loose blob near its own centre and the simulation resolves the detail.
	const members = new Map<number, string[]>();
	for (const node of graph.nodes()) {
		const community = communityOf.get(node) ?? -1;
		(members.get(community) ?? members.set(community, []).get(community)!).push(node);
	}

	const ordered = [...members.entries()].sort((a, b) => b[1].length - a[1].length);
	const centres = spiral(ordered.length, NODE_GAP * 14);
	ordered.forEach(([, group], index) => {
		const centre = centres[index];
		// Jitter, not a fixed point: identical coordinates give a zero distance
		// vector and ForceAtlas2 divides by it, producing NaN for the whole graph.
		const spread = NODE_GAP * Math.sqrt(group.length);
		for (const node of group) {
			graph.setNodeAttribute(node, 'x', centre.x + (random() - 0.5) * spread);
			graph.setNodeAttribute(node, 'y', centre.y + (random() - 0.5) * spread);
		}
	});

	// --- 3. Simulate ---------------------------------------------------------
	forceAtlas2.assign(graph, {
		iterations: ITERATIONS,
		// Spelled out rather than left to the default, because the intra-community
		// weighting above is load-bearing: at influence 0 the weights are ignored
		// and the communities stop being pulled together.
		getEdgeWeight: 'weight',
		settings: {
			edgeWeightInfluence: 1,
			linLogMode: true,
			outboundAttractionDistribution: true,
			// Barnes-Hut approximates distant repulsion, which is what makes ~3k
			// nodes tractable; below that the exact O(n^2) pass is faster.
			barnesHutOptimize: graph.order > 1000,
			barnesHutTheta: 0.6,
			// LinLog attraction is far weaker than the linear model, so repulsion
			// has to come down with it or the graph simply expands forever.
			scalingRatio: 1,
			gravity: 1,
			slowDown: 10,
			adjustSizes: false
		}
	});

	const positions = new Map<string, { x: number; y: number }>();
	for (const node of graph.nodes()) {
		const x = graph.getNodeAttribute(node, 'x') as number;
		const y = graph.getNodeAttribute(node, 'y') as number;
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error(`Force layout diverged: ${node} is at (${x}, ${y})`);
		}
		positions.set(node, { x, y });
	}

	// --- 4. Rescale to the same footprint as the other layouts ---------------
	// ForceAtlas2's output scale depends on the settings, not on the data, so
	// without this the force view would load at a wildly different zoom from the
	// other two and switching would feel like a jump rather than a rearrangement.
	const spread = Math.max(
		...[...positions.values()].map((point) => Math.hypot(point.x, point.y)),
		1
	);
	const targetSpread = NODE_GAP * Math.sqrt(graph.order);
	const scale = targetSpread / spread;
	for (const [code, point] of positions) {
		positions.set(code, { x: point.x * scale, y: point.y * scale });
	}

	// --- 5. Anchor each community on what the simulation produced ------------
	const anchorOf = new Map<number, { x: number; y: number; radius: number }>();
	for (const [community, group] of members) {
		let sumX = 0;
		let sumY = 0;
		for (const node of group) {
			const point = positions.get(node)!;
			sumX += point.x;
			sumY += point.y;
		}
		const centre = { x: sumX / group.length, y: sumY / group.length };
		const radius = Math.max(
			...group.map((node) =>
				Math.hypot(positions.get(node)!.x - centre.x, positions.get(node)!.y - centre.y)
			),
			NODE_GAP
		);
		anchorOf.set(community, { ...centre, radius });
	}

	// --- 6. Place the courses the simulation never saw ------------------------
	const subjectCommunity = dominantCommunityBySubject(communityOf, subjectOf);
	const orbiting = new Map<number, string[]>();
	for (const code of codes) {
		if (positions.has(code)) continue;
		const community =
			assignedCommunity.get(code) ?? subjectCommunity.get(subjectOf.get(code) ?? '') ?? -1;
		(orbiting.get(community) ?? orbiting.set(community, []).get(community)!).push(code);
	}

	// A community can be *entirely* edge-less - ASIA and ARTH are, between them
	// 340 courses - so the simulation never placed a single member and there is no
	// anchor to orbit. Left to default to the origin they all landed on top of the
	// busiest part of the map. They get their own places in a belt outside the
	// simulated cloud instead: still on the map, legibly peripheral, and honest
	// about having no structural signal to position them by.
	const cloudRadius = Math.max(
		...[...positions.values()].map((point) => Math.hypot(point.x, point.y)),
		NODE_GAP
	);
	const unanchored = [...orbiting.keys()]
		.filter((community) => !anchorOf.has(community))
		// Largest first, and by id on a tie, so the belt is stable across rebuilds.
		.sort((a, b) => orbiting.get(b)!.length - orbiting.get(a)!.length || a - b);

	let beltRadius = cloudRadius + NODE_GAP * 6;
	let beltAngle = 0;
	let beltRowDepth = 0;
	for (const community of unanchored) {
		const radius = NODE_GAP * Math.sqrt(orbiting.get(community)!.length) + NODE_GAP;
		// Angle this blob needs at the current belt radius, plus a margin.
		const step = Math.min((2.3 * radius) / beltRadius, Math.PI);
		if (beltAngle + step > Math.PI * 2) {
			beltRadius += beltRowDepth * 2.4 + NODE_GAP * 2;
			beltAngle = 0;
			beltRowDepth = 0;
		}
		const angle = beltAngle + step / 2;
		anchorOf.set(community, {
			x: beltRadius * Math.cos(angle),
			y: beltRadius * Math.sin(angle),
			radius
		});
		beltAngle += step;
		beltRowDepth = Math.max(beltRowDepth, radius);
	}

	for (const [community, group] of orbiting) {
		const anchor = anchorOf.get(community)!;
		// Sorted so a subject stays contiguous rather than scattered through the ring.
		group.sort();

		if (unanchored.includes(community)) {
			// Nothing to orbit: fill the blob outright rather than ringing a void.
			spiral(group.length, NODE_GAP * 0.8).forEach((point, index) =>
				positions.set(group[index], { x: anchor.x + point.x, y: anchor.y + point.y })
			);
			continue;
		}

		const perRing = Math.max(24, Math.ceil(group.length / 6));
		group.forEach((code, index) => {
			const ring = Math.floor(index / perRing);
			const within = index % perRing;
			const radius = anchor.radius + NODE_GAP * 0.75 * (ring + 1.6);
			const angle = (within / perRing) * Math.PI * 2 + ring * 0.4;
			positions.set(code, {
				x: anchor.x + radius * Math.cos(angle),
				y: anchor.y + radius * Math.sin(angle)
			});
		});
	}

	for (const code of codes) {
		if (!positions.has(code)) positions.set(code, { x: 0, y: 0 });
	}

	// --- 7. Final community geometry, over everything actually drawn ----------
	// Computed from the finished positions, not from the simulation alone, so a
	// label covers a community's isolated courses too rather than sitting inside
	// the ring they form.
	const settled = new Map<number, { x: number; y: number; radius: number }>();
	const finalMembers = new Map<number, string[]>();
	for (const code of codes) {
		const community =
			assignedCommunity.get(code) ?? subjectCommunity.get(subjectOf.get(code) ?? '') ?? -1;
		(finalMembers.get(community) ?? finalMembers.set(community, []).get(community)!).push(code);
	}
	for (const [community, group] of finalMembers) {
		let sumX = 0;
		let sumY = 0;
		for (const code of group) {
			sumX += positions.get(code)!.x;
			sumY += positions.get(code)!.y;
		}
		const centre = { x: sumX / group.length, y: sumY / group.length };
		const radius = Math.max(
			...group.map((code) =>
				Math.hypot(positions.get(code)!.x - centre.x, positions.get(code)!.y - centre.y)
			),
			NODE_GAP
		);
		settled.set(community, { ...centre, radius });
	}

	// --- 8. Measure the separation achieved ----------------------------------
	let intraSum = 0;
	let intraCount = 0;
	let interSum = 0;
	let interCount = 0;
	for (const [from, to] of edges) {
		const a = positions.get(from);
		const b = positions.get(to);
		if (!a || !b) continue;
		const distance = Math.hypot(a.x - b.x, a.y - b.y);
		if (communityOf.has(from) && communityOf.get(from) === communityOf.get(to)) {
			intraSum += distance;
			intraCount += 1;
		} else {
			interSum += distance;
			interCount += 1;
		}
	}
	const intra = intraCount ? intraSum / intraCount : 0;
	const inter = interCount ? interSum / interCount : 0;

	return {
		positions,
		communities: settled,
		quality: { intra, inter, ratio: intra ? inter / intra : 0 }
	};
}
