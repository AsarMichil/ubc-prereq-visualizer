/**
 * Labels for the builder's "or" junctions.
 *
 * Alternative prerequisites meet at a junction node before a single arrow
 * carries on to the course. The node's label is drawn as a small pill centred
 * on the junction itself rather than beside it, so the word sits where the
 * lines meet and reads as part of the edge, not as another course.
 *
 * Every other node falls through to Sigma's own label and to the themed hover.
 */
import type { Attributes } from 'graphology-types';
import {
	drawDiscNodeLabel,
	type NodeHoverDrawingFunction,
	type NodeLabelDrawingFunction
} from 'sigma/rendering';
import { EDGE_COLOR, INK, SURFACE, type Theme } from './palette';

const isJunction = (data: object): boolean => (data as { junction?: boolean }).junction === true;

export function makeJunctionLabelRenderer<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
>(theme: Theme): NodeLabelDrawingFunction<N, E, G> {
	return (context, data, settings) => {
		if (!isJunction(data)) return drawDiscNodeLabel(context, data, settings);

		const label = data.label ?? '';
		const size = Math.round(settings.labelSize * 0.85);
		context.font = `500 ${size}px ${settings.labelFont}`;

		const width = context.measureText(label).width + 10;
		const height = size + 6;

		context.beginPath();
		context.fillStyle = SURFACE[theme];
		context.strokeStyle = EDGE_COLOR[theme];
		context.lineWidth = 1.5;
		context.roundRect(data.x - width / 2, data.y - height / 2, width, height, height / 2);
		context.fill();
		context.stroke();

		context.fillStyle = INK[theme].secondary;
		context.textAlign = 'center';
		context.textBaseline = 'middle';
		context.fillText(label, data.x, data.y + 0.5);
		context.textAlign = 'start';
		context.textBaseline = 'alphabetic';
	};
}

/** Junctions are not courses, so hovering one should not offer a course pill. */
export function skipJunctionHover<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
>(hover: NodeHoverDrawingFunction<N, E, G>): NodeHoverDrawingFunction<N, E, G> {
	return (context, data, settings) => {
		if (!isJunction(data)) hover(context, data, settings);
	};
}
