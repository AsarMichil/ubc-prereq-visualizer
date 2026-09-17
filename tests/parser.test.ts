import { describe, expect, it } from 'vitest';
import { parseRequirement, collectCourseCodes } from '../scripts/lib/parseRequirement.ts';
import { parseCourseCode, extractCourseCodes } from '../scripts/lib/normalizeCode.ts';
import type { RequirementNode } from '../src/lib/types.ts';

/** Compact, readable shape for snapshot-style assertions. */
function shape(node: RequirementNode | null): unknown {
	if (!node) return null;
	switch (node.kind) {
		case 'course':
			return node.code;
		case 'highSchoolCourse':
			return `HS:${node.name}`;
		case 'condition':
			return { [node.conditionType]: node.raw };
		case 'unparsed':
			return { unparsed: node.raw };
		case 'withGrade':
			return { [`${node.min}%`]: shape(node.child) };
		case 'all':
			return { all: node.children.map(shape) };
		case 'oneOf':
			return { oneOf: node.children.map(shape) };
		case 'nOf':
			return { [`${node.n}of`]: node.children.map(shape) };
	}
}

describe('parseCourseCode', () => {
	it('normalizes the spellings the calendar actually uses', () => {
		expect(parseCourseCode('BIOL_V 361')?.code).toBe('BIOL 361');
		expect(parseCourseCode('BIOL 361')?.code).toBe('BIOL 361');
		expect(parseCourseCode('FILM433')?.code).toBe('FILM 433');
		expect(parseCourseCode('MATH 101A')?.code).toBe('MATH 101A');
	});

	// Okanagan courses are different courses; merging them would invent edges.
	it('keeps the Okanagan suffix but drops the Vancouver one', () => {
		expect(parseCourseCode('BIOL_O 131')?.code).toBe('BIOL_O 131');
		expect(parseCourseCode('BIOL_O 131')?.campus).toBe('O');
		expect(parseCourseCode('BIOL_V 131')?.campus).toBe('V');
	});

	it('flags 1-2 digit numbers as BC secondary-school courses', () => {
		expect(parseCourseCode('CHEM_V 12')?.isHighSchool).toBe(true);
		expect(parseCourseCode('BIOL 11')?.isHighSchool).toBe(true);
		// Leading-zero university courses are three digits as written.
		expect(parseCourseCode('SCIE 001')?.isHighSchool).toBe(false);
	});

	it('omits high-school courses from bulk extraction by default', () => {
		expect(extractCourseCodes('One of BIOL 11, BIOL 111')).toEqual(['BIOL 111']);
		expect(extractCourseCodes('One of BIOL 11, BIOL 111', true)).toEqual(['BIOL 11', 'BIOL 111']);
	});
});

describe('parseRequirement', () => {
	it('parses a bare course', () => {
		expect(shape(parseRequirement('MANU_V 270'))).toBe('MANU 270');
	});

	it('parses "One of" as a disjunction and "All of" as a conjunction', () => {
		expect(shape(parseRequirement('One of BIOL 361, BIOL 362, CAPS 301'))).toEqual({
			oneOf: ['BIOL 361', 'BIOL 362', 'CAPS 301']
		});
		expect(shape(parseRequirement('All of PHRM_V 211, PHRM_V 212'))).toEqual({
			all: ['PHRM 211', 'PHRM 212']
		});
	});

	// The precedence trap: "and one of ..." must not fold into the preceding list.
	it('does not absorb a following quantifier into a course list', () => {
		expect(
			shape(parseRequirement('All of BIOL 331, BIOL 335 and one of BIOL 201, BIOC 202'))
		).toEqual({ all: [{ all: ['BIOL 331', 'BIOL 335'] }, { oneOf: ['BIOL 201', 'BIOC 202'] }] });
		expect(
			shape(parseRequirement('One of BIOL 340, BIOL 341 and one of BIOL 361, BIOL 362'))
		).toEqual({ all: [{ oneOf: ['BIOL 340', 'BIOL 341'] }, { oneOf: ['BIOL 361', 'BIOL 362'] }] });
	});

	it('parses nested labelled alternatives', () => {
		expect(
			shape(
				parseRequirement(
					'BIOL 336 and either (a) BIOL 200 and one of BIOL 233, BIOL 234; or (b) FRST 302'
				)
			)
		).toEqual({
			all: [
				'BIOL 336',
				{ oneOf: [{ all: ['BIOL 200', { oneOf: ['BIOL 233', 'BIOL 234'] }] }, 'FRST 302'] }
			]
		});
	});

	// A quantifier sitting between "either" and the first label governs the groups.
	it('scopes a quantifier that governs labelled groups', () => {
		expect(
			shape(
				parseRequirement(
					'Either CPSC_V 340 or all of (a) one of AI_V 240, CPSC_V 330 and (b) MATH_V 200'
				)
			)
		).toEqual({
			oneOf: ['CPSC 340', { all: [{ oneOf: ['AI 240', 'CPSC 330'] }, 'MATH 200'] }]
		});
	});

	it('binds a grade threshold to whatever follows "in", including a disjunction', () => {
		expect(shape(parseRequirement('MATH 300 and a score of 68% or higher in MATH 321'))).toEqual({
			all: ['MATH 300', { '68%': 'MATH 321' }]
		});
		expect(
			shape(parseRequirement('A score of 68% or higher in one of MATH 215, MATH 255'))
		).toEqual({
			'68%': { oneOf: ['MATH 215', 'MATH 255'] }
		});
	});

	it('keeps non-course requirements as classified conditions', () => {
		expect(
			shape(parseRequirement('BIOL_V 200 and 3rd-year class standing or higher in Science'))
		).toEqual({
			all: ['BIOL 200', { standing: '3rd-year class standing or higher in Science' }]
		});
		// A program restriction that also mentions standing classifies as program.
		expect(
			shape(
				parseRequirement('Restricted to students in the B.Kin. program with fourth-year standing')
			)
		).toEqual({
			program: 'Restricted to students in the B.Kin. program with fourth-year standing'
		});
		expect(
			shape(parseRequirement('Restricted to students with 2nd year standing or above'))
		).toEqual({
			standing: 'Restricted to students with 2nd year standing or above'
		});
	});

	// A sentence-final period followed by "Or" is a real disjunction (~70 clauses).
	it('treats a sentence break before "Or" as a disjunction', () => {
		expect(
			shape(parseRequirement('All of POLI 100, POLI 101. Or third-year standing or higher'))
		).toEqual({
			oneOf: [{ all: ['POLI 100', 'POLI 101'] }, { standing: 'third-year standing or higher' }]
		});
	});

	it('continues a course list through bare numbers and slashes', () => {
		expect(shape(parseRequirement('One of MATH_V 100, 102, 104'))).toEqual({
			oneOf: ['MATH 100', 'MATH 102', 'MATH 104']
		});
		expect(collectCourseCodes(parseRequirement('LING 201/PHIL 220/PHIL 222'))).toEqual([
			'LING 201',
			'PHIL 220',
			'PHIL 222'
		]);
	});

	it('recovers codes wrapped in square brackets', () => {
		expect(collectCourseCodes(parseRequirement('[ANTH341]'))).toEqual(['ANTH 341']);
	});

	it('conjoins adjacent expressions that have no connective', () => {
		expect(
			collectCourseCodes(parseRequirement('3 credits from one of WRDS_V 150, ENGL_V 100'))
		).toEqual(['WRDS 150', 'ENGL 100']);
	});

	it('returns null for empty input and never throws', () => {
		expect(parseRequirement(null)).toBeNull();
		expect(parseRequirement('   ')).toBeNull();
		expect(() => parseRequirement('((( ;;; ??? )))')).not.toThrow();
	});
});
