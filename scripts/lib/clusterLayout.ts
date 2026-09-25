/**
 * The relatedness layout: positions courses by what they actually connect to,
 * rather than by which faculty owns them.
 *
 * The faculty layout (layoutMap.ts) reflects the org chart, and 38% of
 * prerequisite edges cross a subject boundary - MATH<->PHYS, ECON<->MATH,
 * CPSC<->MATH - so that arrangement pulls genuinely related courses apart.
 * Running community detection over the prerequisite graph instead surfaces
 * groupings the hierarchy hides: an engineering/physical-sciences core spanning
 * MATH, PHYS, ELEC, MECH and CPSC; a life-sciences cluster of BIOL, CHEM, MICB
 * and CAPS; a quantitative-economics group; and so on.
 *
 * Two thirds of courses have no prerequisite links at all and therefore no
 * structural signal. They are placed in orbit around the community their
 * subject mostly belongs to - inferred from subject rather than measured from
 * edges, which is the best available signal and is styled distinctly in the UI.
 */
import Graph from 'graphology';
import louvain from 'graphology-communities-louvain';

export interface ClusterLayoutInput {
	/** Every course code to place. */
	codes: string[];
	/** Prerequisite edges as [prerequisite, dependent]. */
	edges: [string, string][];
	subjectOf: Map<string, string>;
}

export interface ClusterLayoutResult {
	positions: Map<string, { x: number; y: number }>;
	/** Community id per *connected* course, so the UI can label and colour regions. */
	communityOf: Map<string, number>;
	/**
	 * Community id per course, including the ones with no edges - they are filed
	 * under their subject's community, and a subject with no connected course
	 * anywhere gets a community of its own. Other layouts need this to group the
	 * same courses the same way; `communityOf` alone would leave two thirds of
	 * the corpus unassigned.
	 */
	assignedCommunity: Map<string, number>;
	/** Label and centre for each community, derived from its dominant subjects. */
	communities: {
		id: number;
		label: string;
		x: number;
		y: number;
		size: number;
		/** Radius of the drawn cluster, so a label can sit clear of its dots. */
		radius: number;
	}[];
}

const NODE_GAP = 190;
const COMMUNITY_GAP = 900;

/** Deterministic RNG so a rebuild produces the same map. */
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

/** Names a community after the subjects that dominate it. */
function labelFor(members: string[], subjectOf: Map<string, string>): string {
	const counts = new Map<string, number>();
	for (const code of members) {
		const subject = subjectOf.get(code);
		if (subject) counts.set(subject, (counts.get(subject) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 2)
		.map(([subject]) => subject)
		.join(' · ');
}

/**
 * The community each subject mostly belongs to, by majority vote of its
 * connected courses.
 *
 * Two thirds of courses have no prerequisite edges and so no structural signal
 * at all. Their subject is the only thing left to go on, and it is a good
 * proxy: a subject's connected courses overwhelmingly land in one community.
 */
export function dominantCommunityBySubject(
	communityOf: Map<string, number>,
	subjectOf: Map<string, string>
): Map<string, number> {
	const votes = new Map<string, Map<number, number>>();
	for (const [code, community] of communityOf) {
		const subject = subjectOf.get(code);
		if (!subject) continue;
		const tally = votes.get(subject) ?? votes.set(subject, new Map()).get(subject)!;
		tally.set(community, (tally.get(community) ?? 0) + 1);
	}

	const dominant = new Map<string, number>();
	for (const [subject, tally] of votes) {
		const [best] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
		dominant.set(subject, best[0]);
	}
	return dominant;
}

export function clusterLayout(input: ClusterLayoutInput): ClusterLayoutResult {
	const { codes, edges, subjectOf } = input;
	const present = new Set(codes);

	// --- 1. Communities over the connected part -----------------------------
	// Undirected: for "what belongs with what", a prerequisite is a tie either way.
	const graph = new Graph({ type: 'undirected' });
	for (const [from, to] of edges) {
		if (!present.has(from) || !present.has(to) || from === to) continue;
		if (!graph.hasNode(from)) graph.addNode(from);
		if (!graph.hasNode(to)) graph.addNode(to);
		graph.mergeEdge(from, to);
	}

	const communityOf = new Map<string, number>();
	if (graph.order > 0) {
		const detected = louvain(graph, { rng: seededRandom(0x5eed) }) as Record<string, number>;
		for (const [code, community] of Object.entries(detected)) communityOf.set(code, community);
	}

	// --- 2. Unconnected courses inherit their subject's dominant community ---
	const subjectCommunity = dominantCommunityBySubject(communityOf, subjectOf);

	// Subjects with no connected course anywhere get their own bucket, so they
	// are not all dumped into whichever community happens to be numbered first.
	let nextCommunity = Math.max(-1, ...communityOf.values()) + 1;
	const orbiting = new Map<string, string[]>();
	for (const code of codes) {
		if (communityOf.has(code)) continue;
		const subject = subjectOf.get(code) ?? '';
		if (!subjectCommunity.has(subject)) subjectCommunity.set(subject, nextCommunity++);
		(orbiting.get(subject) ?? orbiting.set(subject, []).get(subject)!).push(code);
	}

	// Every course's community, including the ones Louvain never saw.
	const assignedCommunity = new Map(communityOf);
	for (const [subject, group] of orbiting) {
		const community = subjectCommunity.get(subject)!;
		for (const code of group) assignedCommunity.set(code, community);
	}

	// --- 3. Group members per community -------------------------------------
	const connectedMembers = new Map<number, string[]>();
	for (const [code, community] of communityOf) {
		(connectedMembers.get(community) ?? connectedMembers.set(community, []).get(community)!).push(
			code
		);
	}
	const orbitMembers = new Map<number, string[]>();
	for (const [subject, members] of orbiting) {
		const community = subjectCommunity.get(subject)!;
		const list = orbitMembers.get(community) ?? orbitMembers.set(community, []).get(community)!;
		list.push(...members);
	}

	const allCommunities = new Set([...connectedMembers.keys(), ...orbitMembers.keys()]);

	// --- 4. Lay out each community, then place the communities --------------
	const local = new Map<
		number,
		{ positions: Map<string, { x: number; y: number }>; radius: number }
	>();

	for (const community of allCommunities) {
		const connected = (connectedMembers.get(community) ?? []).sort();
		const orbit = (orbitMembers.get(community) ?? []).sort();
		const positions = new Map<string, { x: number; y: number }>();

		// Connected courses fill the core, sorted by degree so hubs land centrally.
		const byDegree = [...connected].sort(
			(a, b) => (graph.hasNode(b) ? graph.degree(b) : 0) - (graph.hasNode(a) ? graph.degree(a) : 0)
		);
		spiral(byDegree.length, NODE_GAP).forEach((point, index) =>
			positions.set(byDegree[index], point)
		);

		const coreRadius = NODE_GAP * Math.sqrt(Math.max(byDegree.length, 1));

		// Unconnected courses ring the core, grouped so a subject stays contiguous.
		const ringGap = NODE_GAP * 0.75;
		orbit.forEach((code, index) => {
			const ring = Math.floor(index / Math.max(24, orbit.length / 6));
			const withinRing = index % Math.max(24, orbit.length / 6);
			const perRing = Math.max(24, orbit.length / 6);
			const radius = coreRadius + ringGap * (ring + 1.6);
			const angle = (withinRing / perRing) * Math.PI * 2 + ring * 0.4;
			positions.set(code, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
		});

		const radius = Math.max(
			coreRadius,
			...[...positions.values()].map((p) => Math.hypot(p.x, p.y))
		);
		local.set(community, { positions, radius: radius || NODE_GAP });
	}

	// Communities are shelf-packed largest-first rather than spread on a uniform
	// spiral: spacing every community for the size of the biggest one left the
	// map five times larger than it needed to be and almost entirely empty.
	const ordered = [...allCommunities].sort(
		(a, b) => (local.get(b)?.radius ?? 0) - (local.get(a)?.radius ?? 0)
	);

	const boxes = ordered.map((community) => {
		const radius = local.get(community)!.radius;
		return { community, side: radius * 2 + COMMUNITY_GAP };
	});

	const totalArea = boxes.reduce((sum, box) => sum + box.side * box.side, 0);
	const targetWidth = Math.max(Math.sqrt(totalArea * 1.1), boxes[0]?.side ?? 1);

	const positions = new Map<string, { x: number; y: number }>();
	const communities: ClusterLayoutResult['communities'] = [];

	let cursorX = 0;
	let rowTop = 0;
	let rowHeight = 0;

	for (const box of boxes) {
		if (cursorX > 0 && cursorX + box.side > targetWidth) {
			rowTop += rowHeight;
			cursorX = 0;
			rowHeight = 0;
		}

		const centre = { x: cursorX + box.side / 2, y: rowTop + box.side / 2 };
		cursorX += box.side;
		rowHeight = Math.max(rowHeight, box.side);

		const block = local.get(box.community)!;
		for (const [code, point] of block.positions) {
			positions.set(code, { x: centre.x + point.x, y: centre.y + point.y });
		}

		const members = [...block.positions.keys()];
		communities.push({
			id: box.community,
			label: labelFor(members, subjectOf),
			x: centre.x,
			y: centre.y,
			size: members.length,
			radius: block.radius
		});
	}

	// Anything unplaced (shouldn't happen) still needs a position.
	for (const code of codes) {
		if (!positions.has(code)) positions.set(code, { x: 0, y: 0 });
	}

	return { positions, communityOf, assignedCommunity, communities };
}
