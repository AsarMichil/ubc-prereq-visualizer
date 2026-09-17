import { describe, expect, it } from 'vitest';
import { parseRequirement } from '../scripts/lib/parseRequirement.ts';
import {
	alwaysRequired,
	groupSatisfied,
	requirementGroups,
	displayGroups,
	type OptionNode
} from '../src/lib/graph/requirementGroups.ts';

const groupsFor = (clause: string) => requirementGroups(parseRequirement(clause));

/** Compact shape: "required: A, B" / "choose 1: A, B". */
const summarise = (clause: string) =>
	groupsFor(clause).map(
		(group) =>
			`${group.kind === 'required' ? 'required' : `choose ${group.n}`}: ` +
			group.options.map((option) => option.label).join(' | ')
	);

describe('requirementGroups', () => {
	it('splits a top-level "and" into one row per decision', () => {
		expect(summarise('One of CPSC 210, CPEN 221 and one of CPSC 121, MATH 220')).toEqual([
			'choose 1: CPSC 210 | CPEN 221',
			'choose 1: CPSC 121 | MATH 220'
		]);
	});

	it('keeps a lone course as a required row', () => {
		expect(summarise('MANU_V 270')).toEqual(['required: MANU 270']);
	});

	it('separates the mandatory course from the choice', () => {
		const rows = summarise('BIOL 336 and one of BIOL 233, BIOL 234');
		expect(rows).toEqual(['required: BIOL 336', 'choose 1: BIOL 233 | BIOL 234']);
		expect(alwaysRequired(groupsFor('BIOL 336 and one of BIOL 233, BIOL 234'))).toEqual([
			'BIOL 336'
		]);
	});

	it('reports nothing as always-required when every row is a choice', () => {
		expect(
			alwaysRequired(groupsFor('One of CPSC 210, CPEN 221 and one of CPSC 121, MATH 220'))
		).toEqual([]);
	});

	it('exposes a grade-gated course as a selectable course, not a condition', () => {
		const [group] = groupsFor('a score of 68% or higher in MATH 226');
		expect(group.options[0]).toMatchObject({ kind: 'course', code: 'MATH 226' });
		expect(group.options[0].label).toContain('68%');
	});

	it('keeps a nested alternative as a compound carrying its courses', () => {
		const [group] = groupsFor('Either (a) BIOL 200 and one of BIOL 233, BIOL 234; or (b) FRST 302');
		expect(group.kind).toBe('choose');
		const [first, second] = group.options;
		expect(first).toMatchObject({ kind: 'compound' });
		expect(first.kind === 'compound' && first.courses).toEqual([
			'BIOL 200',
			'BIOL 233',
			'BIOL 234'
		]);
		expect(second).toMatchObject({ kind: 'course', code: 'FRST 302' });
	});

	it('marks non-course requirements as conditions', () => {
		const [group] = groupsFor('Third-year standing or higher');
		expect(group.options[0].kind).toBe('condition');
	});

	it('returns no rows when a course has no prerequisite', () => {
		expect(requirementGroups(null)).toEqual([]);
	});

	it('honours an n-of quantifier', () => {
		expect(summarise('Two of POLI 100, POLI 101, POLI 110')).toEqual([
			'choose 2: POLI 100 | POLI 101 | POLI 110'
		]);
	});
});

describe('groupSatisfied', () => {
	const [choice] = groupsFor('One of CPSC 210, CPEN 221');
	// A compound is the only way a single row carries several required courses;
	// a top-level "All of A, B" is two independent rows (asserted below).
	const required = groupsFor('Either (a) MATH 100 and MATH 101; or (b) MATH 105')[0]
		.options[0] as Extract<OptionNode, { kind: 'compound' }>;

	it('needs one selection for a choice row', () => {
		expect(groupSatisfied(choice, new Set())).toBe(false);
		expect(groupSatisfied(choice, new Set(['CPSC 210']))).toBe(true);
		// Selecting both is allowed - you may want to compare two options.
		expect(groupSatisfied(choice, new Set(['CPSC 210', 'CPEN 221']))).toBe(true);
	});

	it('needs every selection for a required row', () => {
		expect(groupSatisfied(required.group, new Set(['MATH 100']))).toBe(false);
		expect(groupSatisfied(required.group, new Set(['MATH 100', 'MATH 101']))).toBe(true);
	});

	it('splits a top-level "All of" into independent rows', () => {
		const rows = groupsFor('All of MATH 100, MATH 101');
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.kind === 'required')).toBe(true);
	});

	it('treats a condition-only row as already satisfied', () => {
		const [conditionOnly] = groupsFor('Third-year standing or higher');
		expect(groupSatisfied(conditionOnly, new Set())).toBe(true);
	});

	it('counts a compound as chosen when any of its courses is selected', () => {
		const [group] = groupsFor('Either (a) BIOL 200 and one of BIOL 233; or (b) FRST 302');
		expect(groupSatisfied(group, new Set(['BIOL 200']))).toBe(true);
	});
});

describe('displayGroups', () => {
	it('removes courses already drawn and records what satisfied the row', () => {
		const [row] = displayGroups(groupsFor('One of CPSC 210, CPEN 221'), new Set(['CPSC 210']));
		expect(row.satisfiedBy).toEqual(['CPSC 210']);
		expect(row.visible.map((o) => o.label)).toEqual(['CPEN 221']);
		expect(row.unavailable).toBe(false);
	});

	it('removes Okanagan courses, which cannot be taken here', () => {
		const [row] = displayGroups(groupsFor('One of CPSC 121, MATH_O 220'), new Set());
		expect(row.visible.map((o) => o.label)).toEqual(['CPSC 121']);
	});

	// 2 rows in the whole calendar are Okanagan-only; they must not render blank.
	it('flags a row whose every option was filtered out', () => {
		const [row] = displayGroups(groupsFor('MATH_O 100'), new Set());
		expect(row.visible).toEqual([]);
		expect(row.unavailable).toBe(true);
	});

	it('keeps conditions and high-school courses, which are never selectable', () => {
		const [row] = displayGroups(groupsFor('Third-year standing or higher'), new Set());
		expect(row.visible).toHaveLength(1);
		expect(row.unavailable).toBe(false);
	});
});

describe('displayGroups · preserving prose', () => {
	// CPSC 320's requirement bundles a real credits rule with Okanagan-only
	// courses. Removing the unusable codes must not remove the rule.
	it('keeps the wording when an all-Okanagan option still states a requirement', () => {
		const clause =
			'at least 3 credits from MATH_V or STAT_V at 200 level or above or MATH_O 200, MATH_O 220';
		const [row] = displayGroups(groupsFor(clause), new Set());

		expect(row.unavailable).toBe(false);
		expect(row.visible).toHaveLength(1);
		expect(row.visible[0].kind).toBe('condition');
		expect(row.visible[0].label).toContain('at least 3 credits');
		expect(row.visible[0].label).not.toContain('MATH_O');
	});

	it('still reports a row as unavailable when only bare codes remain', () => {
		const [row] = displayGroups(groupsFor('MATH_O 100'), new Set());
		expect(row.unavailable).toBe(true);
	});
});
