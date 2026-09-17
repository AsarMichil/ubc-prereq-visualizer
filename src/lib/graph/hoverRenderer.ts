/**
 * Themed node-hover rendering.
 *
 * Sigma's built-in hover draws a hardcoded white pill behind the label, which on
 * the dark surface appears as a bright block covering the course code. There is
 * no colour setting for it - the hover is a drawing function - so we supply one
 * that takes its colours from the theme.
 */
import type { Attributes } from 'graphology-types';
import type { NodeHoverDrawingFunction } from 'sigma/rendering';
import type { Settings } from 'sigma/settings';
import type { NodeDisplayData, PartialButFor } from 'sigma/types';
import { INK, SURFACE, type Theme } from './palette';

type HoverData = PartialButFor<NodeDisplayData, 'x' | 'y' | 'size' | 'label' | 'color'>;

export function makeHoverRenderer<
	N extends Attributes = Attributes,
	E extends Attributes = Attributes,
	G extends Attributes = Attributes
>(theme: Theme): NodeHoverDrawingFunction<N, E, G> {
	return function drawHover(
		context: CanvasRenderingContext2D,
		data: HoverData,
		settings: Settings<N, E, G>
	): void {
		const size = settings.labelSize;
		const font = settings.labelFont;
		const weight = settings.labelWeight;

		context.font = `${weight} ${size}px ${font}`;

		const label = data.label ?? '';
		const padding = 6;
		const textWidth = label ? context.measureText(label).width : 0;
		const boxHeight = Math.max(size + padding * 2, data.size * 2 + padding);
		const boxWidth = data.size + padding * 2 + (label ? textWidth + padding : 0);

		const x = data.x - data.size - padding;
		const y = data.y - boxHeight / 2;

		// A filled pill in the surface colour, ringed so it reads against both the
		// canvas and any node it overlaps.
		context.beginPath();
		context.fillStyle = SURFACE[theme];
		context.strokeStyle = INK[theme].muted;
		context.lineWidth = 1;
		context.roundRect(x, y, boxWidth, boxHeight, boxHeight / 2);
		context.fill();
		context.stroke();
		context.closePath();

		// The node mark itself, then its label in theme ink.
		context.beginPath();
		context.fillStyle = data.color;
		context.arc(data.x, data.y, data.size, 0, Math.PI * 2);
		context.fill();
		context.closePath();

		if (label) {
			context.fillStyle = INK[theme].primary;
			context.fillText(label, data.x + data.size + padding, data.y + size / 3);
		}
	};
}
