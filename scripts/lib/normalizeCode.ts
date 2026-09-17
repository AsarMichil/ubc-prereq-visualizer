/**
 * Course-code normalization.
 *
 * The calendar spells the same course several ways, all verified in live data:
 *   "BIOL 361"    canonical
 *   "BIOL_V 361"  with the Vancouver campus suffix
 *   "FILM433"     no space at all (common in `Equivalency:` values)
 *   "MATH 101A"   letter-suffixed number
 *
 * All four denote one course, so identity is (subject, number) with the campus
 * suffix stripped.
 */
import type { CourseCode } from '../../src/lib/types.ts';

/**
 * Matches a course reference. The separator is optional because the calendar
 * sometimes omits it; the number is 1-3 digits because BC secondary-school
 * courses ("BIOL 11") appear in prerequisite lists alongside university ones.
 */
export const COURSE_CODE_PATTERN = /\b([A-Z]{2,5})(_[VO])?\s*(\d{1,3}[A-Z]?)\b/g;

export interface ParsedCode {
	subject: string;
	/** 'V' for Vancouver (the default) or 'O' for Okanagan. */
	campus: 'V' | 'O';
	/** Numeric part with any letter suffix removed. */
	number: number;
	/** Number exactly as written, including a letter suffix. */
	numberLabel: string;
	code: CourseCode;
	/**
	 * True for 1-2 digit numbers, which are BC secondary-school courses
	 * (`BIOL 11`, `CHEM_V 12`) rather than UBC courses. They will never resolve
	 * to a course node, so they must be classified rather than dropped.
	 */
	isHighSchool: boolean;
}

/** Normalizes a single reference, or returns null if it isn't shaped like one. */
export function parseCourseCode(raw: string): ParsedCode | null {
	const match = /^\s*([A-Z]{2,5})(_[VO])?\s*(\d{1,3}[A-Z]?)\s*$/.exec(raw);
	if (!match) return null;

	const [, subject, campusSuffix, numberLabel] = match;
	const number = Number.parseInt(numberLabel, 10);
	// "_V" is Vancouver and is dropped, but "_O" is Okanagan — a genuinely
	// different course. Keeping the suffix stops BIOL_O 131 from being merged
	// into a Vancouver BIOL 131 and fabricating an edge that doesn't exist.
	const campus = campusSuffix === '_O' ? 'O' : 'V';
	const qualifier = campus === 'O' ? '_O' : '';

	return {
		subject,
		campus,
		number,
		numberLabel,
		code: `${subject}${qualifier} ${numberLabel}`,
		// Leading-zero forms like "SCIE 001" are university courses written with
		// three digits, so test the written length rather than the parsed value.
		isHighSchool: numberLabel.replace(/[A-Z]$/, '').length < 3
	};
}

/** Convenience wrapper: normalized string form, or null. */
export function normalizeCode(raw: string): CourseCode | null {
	return parseCourseCode(raw)?.code ?? null;
}

/** Every course reference appearing anywhere in a blob of text, de-duplicated. */
export function extractCourseCodes(text: string, includeHighSchool = false): CourseCode[] {
	const found = new Set<CourseCode>();

	for (const match of text.matchAll(COURSE_CODE_PATTERN)) {
		const parsed = parseCourseCode(match[0]);
		if (!parsed) continue;
		if (parsed.isHighSchool && !includeHighSchool) continue;
		found.add(parsed.code);
	}

	return [...found];
}
