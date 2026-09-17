/**
 * Colour assignment for the map.
 *
 * Colour encodes **year level**, not faculty. There are 14 faculties, far past
 * the 8-hue categorical ceiling, and on a map any two faculties can end up
 * adjacent — the all-pairs case, where only three categorical slots clear the
 * CVD floors. Faculty identity is therefore carried by spatial region plus a
 * region label, which is stronger than hue would have been anyway, and colour is
 * freed for year level, which is genuinely ordinal.
 *
 * Year tiers collapse 5xx-7xx into one "graduate" step: seven steps could not
 * hold a visible lightness gap inside the ramp's usable range, and the
 * undergraduate/graduate split is the distinction the filters care about.
 *
 * Every value below was checked with the palette validator:
 *   ordinal ramp, light + dark ...... all checks pass
 *   focus roles, --pairs all ........ all checks pass (worst CVD ΔE 9.2 / 9.4)
 * The aqua focus role sits at 2.74:1 on the light surface, so nodes in that role
 * always carry a visible label — the relief rule, not a dismissable warning.
 */

export type Theme = 'light' | 'dark';

/** 1xx, 2xx, 3xx, 4xx, graduate. */
export const YEAR_TIERS = ['1st year', '2nd year', '3rd year', '4th year', 'Graduate'] as const;

/** Blue ramp. Low tiers recede toward the surface in both modes. */
const YEAR_COLORS: Record<Theme, string[]> = {
	// steps 250, 400, 500, 600, 700
	light: ['#86b6ef', '#3987e5', '#256abf', '#184f95', '#0d366b'],
	// steps 600, 450, 350, 200, 100
	dark: ['#184f95', '#2a78d6', '#5598e7', '#9ec5f4', '#cde2fb']
};

/** Roles in the focus view. Deliberately off the blue ramp so they never read as a year. */
export const FOCUS_COLORS: Record<
	Theme,
	{ prerequisite: string; unlocks: string; selected: string }
> = {
	light: { prerequisite: '#eb6834', unlocks: '#1baf7a', selected: '#0b0b0b' },
	dark: { prerequisite: '#d95926', unlocks: '#199e70', selected: '#ffffff' }
};

export const SURFACE: Record<Theme, string> = { light: '#fcfcfb', dark: '#1a1a19' };

export const INK: Record<Theme, { primary: string; secondary: string; muted: string }> = {
	light: { primary: '#0b0b0b', secondary: '#52514e', muted: '#8a8984' },
	dark: { primary: '#ffffff', secondary: '#c3c2b7', muted: '#75746c' }
};

/** Courses referenced by a prerequisite but absent from the calendar. */
export const GHOST_COLOR: Record<Theme, string> = { light: '#c9c8c2', dark: '#45443f' };

export const DIMMED: Record<Theme, string> = { light: '#e8e7e3', dark: '#2a2a27' };

export const EDGE_COLOR: Record<Theme, string> = { light: '#d5d4cf', dark: '#343430' };

/** Course number -> tier index. 100-499 map to 0-3; everything higher is graduate. */
export function yearTier(courseNumber: number): number {
	const year = Math.floor(courseNumber / 100);
	if (year <= 1) return 0;
	return Math.min(year - 1, YEAR_TIERS.length - 1);
}

export function yearColor(courseNumber: number, theme: Theme): string {
	return YEAR_COLORS[theme][yearTier(courseNumber)];
}

/**
 * Distance-from-your-course colouring, used while focusing or building a path.
 *
 * These are the same validated ordinal steps as the year ramp, just ordered
 * near-to-far instead of low-to-high: the nearest hop takes the strongest step
 * and distant hops recede toward the surface. Because it is the same set in the
 * same order (merely reversed), it inherits the ramp's validation - monotone
 * lightness, visible gaps, and a light end that clears the surface.
 *
 * Colour means year level OR hop distance, never both at once; the legend swaps
 * with the mode so a colour is never ambiguous.
 */
export const HOP_TIERS = ['This course', '1 hop', '2 hops', '3 hops', '4+ hops'] as const;

export function hopColor(distance: number, theme: Theme): string {
	const nearToFar = [...YEAR_COLORS[theme]].reverse();
	return nearToFar[Math.min(Math.abs(distance), nearToFar.length - 1)];
}

export function hopSwatches(theme: Theme): { label: string; color: string }[] {
	return HOP_TIERS.map((label, index) => ({ label, color: hopColor(index, theme) }));
}

export function yearSwatches(theme: Theme): { label: string; color: string }[] {
	return YEAR_TIERS.map((label, index) => ({ label, color: YEAR_COLORS[theme][index] }));
}
