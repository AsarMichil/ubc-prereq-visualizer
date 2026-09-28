/**
 * A dashed arrow edge for Sigma, which ships no dashed program of its own.
 *
 * This is Sigma's clamped edge (the line part of its `arrow` type) with one
 * addition: the vertex shader passes down how far each fragment sits from the
 * arrow head, and the fragment shader cuts gaps into the line by that distance.
 * The distance is measured in edge widths rather than pixels or graph units, so
 * the dash pattern keeps its proportions at every zoom level - a dash is always
 * a few times longer than the line is thick.
 *
 * Dashes are counted back from the arrow head, so the line always meets the head
 * with a full dash rather than a gap or a sliver.
 *
 * Picking stays solid: a hit test should not depend on whether the pointer
 * landed on a dash or in a gap.
 */
import type { Attributes } from 'graphology-types';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import {
	createEdgeArrowHeadProgram,
	createEdgeCompoundProgram,
	EdgeProgram,
	type EdgeProgramType,
	type ProgramDefinition,
	type ProgramInfo
} from 'sigma/rendering';
import type { EdgeDisplayData, NodeDisplayData, RenderParams } from 'sigma/types';
import { floatColor } from 'sigma/utils';

/** Dash and gap lengths, in multiples of the edge's width. */
const DASH = 2.5;
const GAP = 2;

/** Matches Sigma's arrow head, so the line stops exactly where the head begins. */
const LENGTH_TO_THICKNESS_RATIO = 2.5;

const VERTEX_SHADER = /* glsl */ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_normal;
attribute float a_normalCoef;
attribute vec2 a_positionStart;
attribute vec2 a_positionEnd;
attribute float a_positionCoef;
attribute float a_radius;
attribute float a_radiusCoef;

uniform mat3 u_matrix;
uniform float u_zoomRatio;
uniform float u_sizeRatio;
uniform float u_pixelRatio;
uniform float u_correctionRatio;
uniform float u_minEdgeThickness;
uniform float u_lengthToThicknessRatio;
uniform float u_feather;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_along;

const float bias = 255.0 / 254.0;

void main() {
  float minThickness = u_minEdgeThickness;

  float radius = a_radius * a_radiusCoef;
  vec2 normal = a_normal * a_normalCoef;
  vec2 position = a_positionStart * (1.0 - a_positionCoef) + a_positionEnd * a_positionCoef;

  float normalLength = length(normal);
  vec2 unitNormal = normal / normalLength;

  float pixelsThickness = max(normalLength, minThickness * u_sizeRatio);
  float webGLThickness = pixelsThickness * u_correctionRatio / u_sizeRatio;

  // Pull the end back to leave room for the target node and the arrow head.
  float direction = sign(radius);
  float webGLNodeRadius = direction * radius * 2.0 * u_correctionRatio / u_sizeRatio;
  float webGLArrowHeadLength = webGLThickness * u_lengthToThicknessRatio * 2.0;
  vec2 compensationVector = vec2(-direction * unitNormal.y, direction * unitNormal.x) * (webGLNodeRadius + webGLArrowHeadLength);

  gl_Position = vec4((u_matrix * vec3(position + unitNormal * webGLThickness + compensationVector, 1)).xy, 0, 1);

  // Where the clamped line actually ends, computed the same way at every vertex
  // (the start vertices carry no radius, so rebuild it from a_radius directly).
  vec2 along = a_positionEnd - a_positionStart;
  float fullLength = length(along);
  float clampedLength = max(
    fullLength - (a_radius * 2.0 * u_correctionRatio / u_sizeRatio + webGLArrowHeadLength),
    0.0
  );
  // Distance back from the arrow head, in edge widths (webGLThickness is half
  // the width, since the quad extends that far either side of the centre line).
  v_along = (1.0 - a_positionCoef) * clampedLength / (webGLThickness * 2.0);

  v_thickness = webGLThickness / u_zoomRatio;
  v_normal = unitNormal;
  v_feather = u_feather * u_correctionRatio / u_zoomRatio / u_pixelRatio * 2.0;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying vec4 v_color;
varying vec2 v_normal;
varying float v_thickness;
varying float v_feather;
varying float v_along;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
const float dash = ${DASH.toFixed(2)};
const float period = ${(DASH + GAP).toFixed(2)};
// Softens each dash end over a fraction of a width, like the side feathering.
const float soft = 0.15;

void main(void) {
  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float dist = length(v_normal) * v_thickness;
  float side = smoothstep(v_thickness - v_feather, v_thickness, dist);

  float phase = mod(v_along, period);
  float gap = smoothstep(dash - soft, dash, phase) * (1.0 - smoothstep(period - soft, period, phase));

  gl_FragColor = mix(v_color, transparent, max(side, gap));
  #endif
}
`;

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;

const UNIFORMS = [
	'u_matrix',
	'u_zoomRatio',
	'u_sizeRatio',
	'u_correctionRatio',
	'u_pixelRatio',
	'u_feather',
	'u_minEdgeThickness',
	'u_lengthToThicknessRatio'
] as const;

class EdgeDashedLineProgram<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
> extends EdgeProgram<(typeof UNIFORMS)[number], N, E, G> {
	getDefinition() {
		return {
			VERTICES: 6,
			VERTEX_SHADER_SOURCE: VERTEX_SHADER,
			FRAGMENT_SHADER_SOURCE: FRAGMENT_SHADER,
			METHOD: WebGLRenderingContext.TRIANGLES,
			UNIFORMS,
			ATTRIBUTES: [
				{ name: 'a_positionStart', size: 2, type: FLOAT },
				{ name: 'a_positionEnd', size: 2, type: FLOAT },
				{ name: 'a_normal', size: 2, type: FLOAT },
				{ name: 'a_color', size: 4, type: UNSIGNED_BYTE, normalized: true },
				{ name: 'a_id', size: 4, type: UNSIGNED_BYTE, normalized: true },
				{ name: 'a_radius', size: 1, type: FLOAT }
			],
			CONSTANT_ATTRIBUTES: [
				// 0 = the start of the edge, 1 = its end.
				{ name: 'a_positionCoef', size: 1, type: FLOAT },
				{ name: 'a_normalCoef', size: 1, type: FLOAT },
				{ name: 'a_radiusCoef', size: 1, type: FLOAT }
			],
			CONSTANT_DATA: [
				[0, 1, 0],
				[0, -1, 0],
				[1, 1, 1],
				[1, 1, 1],
				[0, -1, 0],
				[1, -1, -1]
			]
		};
	}

	processVisibleItem(
		edgeIndex: number,
		startIndex: number,
		sourceData: NodeDisplayData,
		targetData: NodeDisplayData,
		data: EdgeDisplayData
	): void {
		const thickness = data.size || 1;
		const dx = targetData.x - sourceData.x;
		const dy = targetData.y - sourceData.y;
		const squared = dx * dx + dy * dy;

		let n1 = 0;
		let n2 = 0;
		if (squared) {
			const inverse = 1 / Math.sqrt(squared);
			n1 = -dy * inverse * thickness;
			n2 = dx * inverse * thickness;
		}

		const array = this.array;
		array[startIndex++] = sourceData.x;
		array[startIndex++] = sourceData.y;
		array[startIndex++] = targetData.x;
		array[startIndex++] = targetData.y;
		array[startIndex++] = n1;
		array[startIndex++] = n2;
		array[startIndex++] = floatColor(data.color);
		array[startIndex++] = edgeIndex;
		array[startIndex] = targetData.size || 1;
	}

	setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo): void {
		gl.uniformMatrix3fv(uniformLocations.u_matrix, false, params.matrix);
		gl.uniform1f(uniformLocations.u_zoomRatio, params.zoomRatio);
		gl.uniform1f(uniformLocations.u_sizeRatio, params.sizeRatio);
		gl.uniform1f(uniformLocations.u_correctionRatio, params.correctionRatio);
		gl.uniform1f(uniformLocations.u_pixelRatio, params.pixelRatio);
		gl.uniform1f(uniformLocations.u_feather, params.antiAliasingFeather);
		gl.uniform1f(uniformLocations.u_minEdgeThickness, params.minEdgeThickness);
		gl.uniform1f(uniformLocations.u_lengthToThicknessRatio, LENGTH_TO_THICKNESS_RATIO);
	}
}

/**
 * Drop-in for Sigma's `arrow` edge type, with a dashed line. A factory, like
 * Sigma's own `createEdgeArrowProgram`, so it takes the renderer's node type.
 */
export function createEdgeDashedArrowProgram<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
>(): EdgeProgramType<N, E, G> {
	return createEdgeCompoundProgram<N, E, G>([
		EdgeDashedLineProgram<N, E, G>,
		createEdgeArrowHeadProgram<N, E, G>({ lengthToThicknessRatio: LENGTH_TO_THICKNESS_RATIO })
	]);
}

/**
 * The fragment shader of `@sigma/edge-curve`'s curved arrow, with dashes.
 *
 * The package draws each curve as one quad and, per pixel, finds the nearest
 * point on the quadratic Bezier to decide whether the pixel is on the line.
 * Finding that point already yields its parameter `t` - how far along the curve
 * it is - which the package throws away. Keeping it is all dashing needs.
 *
 * `t` is not quite arc length (a quadratic Bezier moves slightly faster near its
 * ends), so `(1 - t)` times the curve's length is an approximation. At the
 * gentle curvatures the builder uses it is within a few percent, which dash
 * spacing does not show. Unlike the straight program this works in pixels,
 * since that is what the package's varyings are in; `v_thickness` is the full
 * width here, so the dash constants still mean "multiples of the width".
 *
 * Only the fragment shader is replaced - the vertex shader, attributes and
 * curve maths are the package's own, so its curves and ours match exactly.
 */
const CURVED_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec4 v_color;
varying float v_thickness;
varying float v_feather;
varying vec2 v_cpA;
varying vec2 v_cpB;
varying vec2 v_cpC;
varying float v_targetSize;
varying vec2 v_targetPoint;

uniform float u_lengthToThicknessRatio;
uniform float u_widenessToThicknessRatio;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);
const float dash = ${DASH.toFixed(2)};
const float period = ${(DASH + GAP).toFixed(2)};
const float soft = 0.15;

float det(vec2 a, vec2 b) {
  return a.x * b.y - b.x * a.y;
}

// The package's closest-point solve, stopping at the parameter. The control
// points are relative to the fragment, so the curve point at t is its offset.
float closestT(vec2 b0, vec2 b1, vec2 b2) {
  float a = det(b0, b2), b = 2.0 * det(b1, b0), d = 2.0 * det(b2, b1);
  float f = b * d - a * a;
  vec2 d21 = b2 - b1, d10 = b1 - b0, d20 = b2 - b0;
  vec2 gf = 2.0 * (b * d21 + d * d10 + a * d20);
  gf = vec2(gf.y, -gf.x);
  vec2 pp = -f * gf / dot(gf, gf);
  vec2 d0p = b0 - pp;
  float ap = det(d0p, d20), bp = 2.0 * det(d10, d0p);
  return clamp((ap + bp) / (2.0 * a + b + d), 0.0, 1.0);
}

void main(void) {
  vec2 p = gl_FragCoord.xy;
  vec2 b0 = v_cpA - p, b1 = v_cpB - p, b2 = v_cpC - p;
  float t = closestT(b0, b1, b2);
  float dist = length(mix(mix(b0, b1, t), mix(b1, b2, t), t));

  float thickness = v_thickness;
  float distToTarget = length(p - v_targetPoint);
  float targetArrowLength = v_targetSize + thickness * u_lengthToThicknessRatio;
  bool inHead = distToTarget < targetArrowLength;
  if (inHead) {
    thickness = (distToTarget - v_targetSize) / (targetArrowLength - v_targetSize) * u_widenessToThicknessRatio * thickness;
  }

  float halfThickness = thickness / 2.0;
  if (dist >= halfThickness) {
    gl_FragColor = transparent;
    return;
  }

  #ifdef PICKING_MODE
  gl_FragColor = v_color;
  #else
  float side = smoothstep(halfThickness - v_feather, halfThickness, dist);

  // Dashes count back from the base of the arrow head, which stays solid.
  float gap = 0.0;
  if (!inHead) {
    float chord = length(v_cpC - v_cpA);
    float polygon = length(v_cpB - v_cpA) + length(v_cpC - v_cpB);
    // Close estimate of a quadratic Bezier's length from its chord and hull.
    float curveLength = (2.0 * chord + polygon) / 3.0;
    float along = ((1.0 - t) * curveLength - targetArrowLength) / v_thickness;
    float phase = mod(along, period);
    gap = smoothstep(dash - soft, dash, phase) * (1.0 - smoothstep(period - soft, period, phase));
  }

  gl_FragColor = mix(v_color, transparent, max(side, gap));
  #endif
}
`;

/** Matches the package's own curved arrow, and the straight arrow's head. */
const CURVED_ARROW_HEAD = {
	extremity: 'target' as const,
	lengthToThicknessRatio: LENGTH_TO_THICKNESS_RATIO,
	widenessToThicknessRatio: 2
};

/** `@sigma/edge-curve`'s curved arrow, typed for the renderer's node attributes. */
export function createEdgeCurvedArrowProgram<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
>(): EdgeProgramType<N, E, G> {
	return createEdgeCurveProgram<N, E, G>({ arrowHead: CURVED_ARROW_HEAD });
}

/** The same curved arrow, dashed. See `CURVED_FRAGMENT_SHADER`. */
export function createEdgeDashedCurvedArrowProgram<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
>(): EdgeProgramType<N, E, G> {
	// The package's declared type hides `getDefinition`, which is all we override.
	const Curved = createEdgeCurveProgram<N, E, G>({
		arrowHead: CURVED_ARROW_HEAD
	}) as unknown as new (...args: ConstructorParameters<EdgeProgramType<N, E, G>>) => {
		getDefinition(): ProgramDefinition;
	};

	class EdgeDashedCurvedArrowProgram extends Curved {
		getDefinition() {
			return { ...super.getDefinition(), FRAGMENT_SHADER_SOURCE: CURVED_FRAGMENT_SHADER };
		}
	}
	return EdgeDashedCurvedArrowProgram as unknown as EdgeProgramType<N, E, G>;
}
