import { describe, expect, it } from 'vitest';
import { matchCreditExclusion } from '../scripts/lib/creditExclusion.ts';
import { parseRequirement } from '../scripts/lib/parseRequirement.ts';
import { requirementGroups, displayGroups } from '../src/lib/graph/requirementGroups.ts';

describe('matchCreditExclusion', () => {
	it('reads the course that names the list', () => {
		const match = matchCreditExclusion(
			'any course on the STAT_V 200 credit exclusion: or HES_O 340'
		);
		expect(match?.course.code).toBe('STAT 200');
		// The colon is debris from the stripped hyperlink and must be consumed, or
		// the next atom starts on punctuation.
		expect(match?.raw).toBe('any course on the STAT_V 200 credit exclusion:');
	});

	it('accepts the "list" wording', () => {
		expect(
			matchCreditExclusion('any course on the MATH_V 100 credit exclusion list')?.course.code
		).toBe('MATH 100');
	});

	it('ignores advisory prose that names no course', () => {
		expect(
			matchCreditExclusion('Please consult the Faculty of Science Credit Exclusion Lists')
		).toBeNull();
	});

	it('ignores a high-school code, which never names a list', () => {
		expect(matchCreditExclusion('any course on the CHEM_V 12 credit exclusion list')).toBeNull();
	});
});

describe('credit exclusion references in a clause', () => {
	const rowsFor = (clause: string) =>
		displayGroups(requirementGroups(parseRequirement(clause)), new Set());

	it('is an alternative, not a separate mandatory course', () => {
		// The bug: "any course on the" became its own condition and STAT 200 was
		// AND-ed on as if it were required outright.
		const rows = rowsFor(
			'at least 3 credits from MATH_V or STAT_V at 200 level or above or any course on the STAT_V 200 credit exclusion:'
		);

		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('choose');
		expect(rows[0].visible.map((option) => option.label)).toEqual([
			'3 credits from MATH or STAT at 200+',
			'STAT 200 or equivalent'
		]);
	});

	it('keeps the list that follows the reference in the same choice', () => {
		// The bracket introducing the members is dropped as punctuation, so they
		// abut the reference with no separator.
		const rows = rowsFor(
			'One of any course on the MATH_V 100 credit exclusion list [ MATH_V 190, SCIE_V 001, MATH_O 100'
		);

		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('choose');
		expect(rows[0].n).toBe(1);
		expect(rows[0].visible.map((option) => option.label)).toEqual([
			'MATH 100 or equivalent',
			'MATH 190',
			'SCIE 001'
		]);
	});

	it('still contributes the named course as an edge', () => {
		// A course is on its own credit exclusion list, so the reference is a real
		// way to satisfy the requirement - dropping it would lose a true edge.
		const node = parseRequirement('any course on the STAT_V 200 credit exclusion:');
		expect(node).toEqual({
			kind: 'creditExclusion',
			code: 'STAT 200',
			raw: 'any course on the STAT_V 200 credit exclusion:'
		});
	});
});
