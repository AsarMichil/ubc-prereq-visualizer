import { describe, expect, it } from 'vitest';
import { matchCreditRequirement } from '../scripts/lib/creditRequirement.ts';
import { parseRequirement } from '../scripts/lib/parseRequirement.ts';
import { displayGroups, requirementGroups } from '../src/lib/graph/requirementGroups.ts';

describe('matchCreditRequirement', () => {
	it('reads a subject list with a level floor', () => {
		expect(
			matchCreditRequirement('3 credits from MATH_V or STAT_V at 200 level or above')
		).toMatchObject({ count: 3, subjects: ['MATH', 'STAT'], minLevel: 200 });
	});

	it('reads a level written before the subject', () => {
		expect(matchCreditRequirement('6 credits of 300-level VISA_V')).toMatchObject({
			count: 6,
			subjects: ['VISA'],
			minLevel: 300
		});
	});

	it('reads a bare subject with no level', () => {
		expect(matchCreditRequirement('24 credits in MATH')).toMatchObject({
			count: 24,
			subjects: ['MATH'],
			minLevel: null
		});
	});

	it('accepts the phrasings UBC puts in front of the count', () => {
		for (const prefix of ['at least ', 'a minimum of ', 'an additional ', '']) {
			expect(matchCreditRequirement(`${prefix}3 credits of PHIL_V`)).toMatchObject({ count: 3 });
		}
	});

	// Prose like "3 credits of science" names no subject code, so there is nothing
	// to match a student's courses against; it stays free text.
	it('ignores credit phrases with no subject code', () => {
		expect(matchCreditRequirement('3 credits of science')).toBeNull();
		expect(matchCreditRequirement('6 credits of literature')).toBeNull();
	});

	it('only matches at the start of the text', () => {
		expect(matchCreditRequirement('CPSC 110 and 3 credits of MATH')).toBeNull();
	});
});

describe('credit requirements in a parsed clause', () => {
	it('parses as its own node, not as free text', () => {
		const ast = parseRequirement('3 credits from MATH_V or STAT_V at 200 level or above');
		expect(ast).toMatchObject({
			kind: 'credits',
			count: 3,
			subjects: ['MATH', 'STAT'],
			minLevel: 200
		});
	});

	it('sits alongside courses in the same requirement', () => {
		const rows = requirementGroups(parseRequirement('CPSC 221 and 6 credits of MATH_V'));
		const kinds = rows.flatMap((row) => row.options.map((option) => option.kind));
		expect(kinds).toContain('course');
		expect(kinds).toContain('credits');
	});

	/**
	 * CPSC 320 states a credit requirement beside Okanagan-only alternatives.
	 * Stripping the unusable codes used to flatten the whole option to prose and
	 * lose the structured part.
	 */
	it('survives having its Okanagan alternatives filtered out', () => {
		const clause =
			'at least 3 credits from MATH_V or STAT_V at 200 level or above or MATH_O 200, MATH_O 220';
		const [row] = displayGroups(requirementGroups(parseRequirement(clause)), new Set());

		const flatten = (options: typeof row.visible): string[] =>
			options.flatMap((option) =>
				option.kind === 'compound'
					? flatten(displayGroups([option.group], new Set())[0].visible)
					: [option.kind]
			);

		expect(flatten(row.visible)).toContain('credits');
	});
});
