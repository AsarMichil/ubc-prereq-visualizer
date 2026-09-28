/**
 * Bends an edge just enough to miss the courses it would otherwise run through.
 *
 * The builder's rows are hop distance from where you started, so an edge can
 * run along a row, or skip one, straight through a course that has nothing to
 * do with it. Rather than re-layering to make that impossible - which pushed
 * courses away from their own prerequisites and turned long edges into
 * zig-zags - each edge stays straight unless something is actually in the way,
 * and then takes the gentlest arc that clears it.
 *
 * Curvature follows `@sigma/edge-curve`: the curve is a quadratic Bezier whose
 * control point sits `curvature * length` off the midpoint, along the edge's
 * left-hand normal (-dy, dx). Positive bows left of source->target, negative
 * right. Sigma's y axis points up on screen, like the layout's, so "left" here
 * is left on screen too.
 */

export interface Point {
	x: number;
	y: number;
}

export interface RoutingOptions {
	/** How close the edge may come to a course's centre, in layout units. */
	clearance: number;
	/**
	 * How far a course's label runs to its right. Labels sit beside the mark, so
	 * an edge through the label is as bad as one through the node.
	 */
	labelWidth: number;
}

/** Arcs to try, gentlest first. Beyond 0.6 a curve reads as a loop, not an edge. */
const CURVATURES = [0.12, 0.2, 0.3, 0.42, 0.6];
const SAMPLES = 24;

/** Distance from `p` to a course: its mark plus the label running right of it. */
function distanceToCourse(p: Point, course: Point, labelWidth: number): number {
	const x = Math.min(Math.max(p.x, course.x), course.x + labelWidth);
	return Math.hypot(p.x - x, p.y - course.y);
}

function pointOnCurve(source: Point, target: Point, curvature: number, t: number): Point {
	const dx = target.x - source.x;
	const dy = target.y - source.y;
	const control = {
		x: (source.x + target.x) / 2 - dy * curvature,
		y: (source.y + target.y) / 2 + dx * curvature
	};
	const u = 1 - t;
	return {
		x: u * u * source.x + 2 * u * t * control.x + t * t * target.x,
		y: u * u * source.y + 2 * u * t * control.y + t * t * target.y
	};
}

/**
 * Closest the edge comes to any of the courses, sampled along its length.
 *
 * The ends are skipped: every edge starts and finishes at a course, and the
 * first and last stretch are inside the courses they join.
 */
function closestApproach(
	source: Point,
	target: Point,
	curvature: number,
	courses: Point[],
	labelWidth: number
): number {
	let closest = Infinity;
	for (let i = 1; i < SAMPLES; i++) {
		const point = pointOnCurve(source, target, curvature, i / SAMPLES);
		for (const course of courses) {
			closest = Math.min(closest, distanceToCourse(point, course, labelWidth));
		}
	}
	return closest;
}

/**
 * The curvature to draw an edge with: 0 when the straight line is clear, else
 * the gentlest arc, on either side, that clears every course.
 *
 * `courses` should exclude the edge's own two ends. If no arc clears them all,
 * the one that comes least close wins - a crowded row can leave no clean route,
 * and a near miss still beats a line through the middle of a course.
 */
export function curvatureAround(
	source: Point,
	target: Point,
	courses: Point[],
	{ clearance, labelWidth }: RoutingOptions
): number {
	if (closestApproach(source, target, 0, courses, labelWidth) >= clearance) return 0;

	let best = { curvature: 0, approach: -Infinity };
	for (const magnitude of CURVATURES) {
		for (const curvature of [magnitude, -magnitude]) {
			const approach = closestApproach(source, target, curvature, courses, labelWidth);
			if (approach >= clearance) return curvature;
			if (approach > best.approach) best = { curvature, approach };
		}
	}
	return best.curvature;
}
