import { describe, expect, it } from 'vitest';
import { matchCreditRequirement } from '../scripts/lib/creditRequirement.ts';
import { parseRequirement } from '../scripts/lib/parseRequirement.ts';
import {
	creditsToward,
	displayGroups,
	groupSatisfied,
	requirementGroups
} from '../src/lib/graph/requirementGroups.ts';

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

describe('satisfying a credit quota', () => {
	const clause = 'at least 3 credits from MATH_V or STAT_V at 200 level or above';
	const groupFor = () => requirementGroups(parseRequirement(clause))[0];
	/** Every course in the corpus is 3 credits unless a test says otherwise. */
	const threeCredits = () => 3;

	it('counts a matching course toward the quota', () => {
		// The point of the node: MATH 200 is not named anywhere in the clause, but
		// it plainly satisfies it.
		expect(groupSatisfied(groupFor(), new Set(['MATH 200']), threeCredits)).toBe(true);
	});

	it('adds up several courses to reach the count', () => {
		const clause6 = 'at least 6 credits from MATH_V or STAT_V at 200 level or above';
		const group = requirementGroups(parseRequirement(clause6))[0];
		expect(groupSatisfied(group, new Set(['MATH 200']), threeCredits)).toBe(false);
		expect(groupSatisfied(group, new Set(['MATH 200', 'STAT 251']), threeCredits)).toBe(true);
	});

	it('rejects a course below the level floor', () => {
		expect(groupSatisfied(groupFor(), new Set(['MATH 100']), threeCredits)).toBe(false);
	});

	it('rejects a subject outside the quota', () => {
		expect(groupSatisfied(groupFor(), new Set(['CPSC 221']), threeCredits)).toBe(false);
	});

	it('does not let an Okanagan course fill a Vancouver quota', () => {
		// "MATH_V or STAT_V" normalizes to MATH/STAT, and the Okanagan equivalents
		// are listed as their own alternatives - so MATH_O 200 must not count here.
		expect(groupSatisfied(groupFor(), new Set(['MATH_O 200']), threeCredits)).toBe(false);
	});

	it('uses each course’s real credit value', () => {
		const oneCredit = () => 1;
		expect(groupSatisfied(groupFor(), new Set(['MATH 200']), oneCredit)).toBe(false);
	});

	it('ignores quotas entirely when no credit lookup is given', () => {
		// Callers that only render structure must not start flagging rows they have
		// no way to evaluate.
		expect(groupSatisfied(groupFor(), new Set())).toBe(true);
	});

	it('reports which courses counted, for display', () => {
		const option = groupFor().options.find((o) => o.kind === 'credits')!;
		const progress = creditsToward(option as never, ['MATH 200', 'CPSC 221'], threeCredits);
		expect(progress).toEqual({ courses: ['MATH 200'], total: 3 });
	});
});
