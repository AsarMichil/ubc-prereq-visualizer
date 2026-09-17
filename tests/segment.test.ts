import { describe, expect, it } from 'vitest';
import { segmentDescription, splitSentences } from '../scripts/lib/segmentDescription.ts';

describe('segmentDescription', () => {
	it('extracts the hours vector and both requirement clauses', () => {
		const result = segmentDescription(
			'Physical and mathematical structures of computation. [3-2-1] ' +
				'Prerequisite: Principles of Mathematics 12 or Pre-calculus 12. ' +
				'Corequisite: One of CPSC 107, CPSC 110.'
		);

		expect(result.hoursVector).toBe('3-2-1');
		expect(result.prerequisiteText).toBe('Principles of Mathematics 12 or Pre-calculus 12');
		expect(result.corequisiteText).toBe('One of CPSC 107, CPSC 110');
		expect(result.descriptionText).toBe('Physical and mathematical structures of computation.');
	});

	// Hazard 1: the credit-exclusion sentence sits mid-description, ahead of the
	// hours vector, so it cannot be treated as a trailing section.
	it('pulls credit exclusion out of the middle of the description', () => {
		const result = segmentDescription(
			'Principles of storage and transmission of genetic variation. ' +
				'Credit will be granted for only one of BIOL 121 or BIOL 344. [3-0-0] ' +
				'Prerequisite: One of BIOL 11, BIOL 12, BIOL 111.'
		);

		expect(result.creditExclusionText).toBe(
			'Credit will be granted for only one of BIOL 121 or BIOL 344'
		);
		expect(result.hoursVector).toBe('3-0-0');
		expect(result.prerequisiteText).toBe('One of BIOL 11, BIOL 12, BIOL 111');
		expect(result.descriptionText).not.toContain('Credit will be granted');
	});

	// Hazard 2: Corequisite can precede Prerequisite.
	it('handles corequisite appearing before prerequisite', () => {
		const result = segmentDescription(
			'Z. Corequisite: MATH_V 255. Prerequisite: All of MATH_V 101, MATH_V 152.'
		);

		expect(result.corequisiteText).toBe('MATH_V 255');
		expect(result.prerequisiteText).toBe('All of MATH_V 101, MATH_V 152');
	});

	it('routes recommendation and waiver sentences into notes', () => {
		const recommended = segmentDescription(
			'X. Prerequisite: One of PHYS 101, PHYS 106, PHYS 107. BIOL 325 is recommended.'
		);
		expect(recommended.prerequisiteText).toBe('One of PHYS 101, PHYS 106, PHYS 107');
		expect(recommended.notes).toEqual(['BIOL 325 is recommended.']);

		const waived = segmentDescription(
			'Y. Prerequisite: All of DHYG 405, DHYG 435. Prerequisites may be waived for others.'
		);
		expect(waived.prerequisiteText).toBe('All of DHYG 405, DHYG 435');
		expect(waived.notes).toEqual(['Prerequisites may be waived for others.']);
	});

	it('keeps "is required" clauses, which are requirements rather than notes', () => {
		const result = segmentDescription(
			'X. Prerequisite: 3rd-year class standing or higher in Science is required.'
		);
		expect(result.prerequisiteText).toBe(
			'3rd-year class standing or higher in Science is required'
		);
		expect(result.notes).toEqual([]);
	});

	// These phrasings were previously parsed as prerequisites, inventing edges
	// such as PATH 409 -> PATH 410 (and a cycle back again).
	it('strips every credit-exclusion phrasing, not just "only one of"', () => {
		const either = segmentDescription(
			'Advanced Hematology. Prerequisite: PATH_V 307. ' +
				'Credit will be granted for either PATH_V 402 or PATH_V 409 and PATH_V 410.'
		);
		expect(either.prerequisiteText).toBe('PATH_V 307');
		expect(either.creditExclusionText).toContain('PATH_V 402');

		const inverted = segmentDescription(
			'X. Credit will only be granted for one of GERM 318 or GMST 311. Prerequisite: GERM 200.'
		);
		expect(inverted.prerequisiteText).toBe('GERM 200');
		expect(inverted.creditExclusionText).toContain('GERM 318');
	});

	it('extracts equivalency separately from credit exclusion', () => {
		const result = segmentDescription(
			'Works of Leo Tolstoy. Credit will be granted for only one of RUSS_V 411 or SLAV_V 447. ' +
				'Equivalency: RUSS_V 411.'
		);
		expect(result.equivalencyText).toBe('RUSS_V 411');
		expect(result.creditExclusionText).toContain('RUSS_V 411 or SLAV_V 447');
	});

	it('returns empty sections for a null or blank description', () => {
		for (const input of [null, undefined, '', '   ']) {
			const result = segmentDescription(input);
			expect(result.prerequisiteText).toBeNull();
			expect(result.descriptionText).toBe('');
		}
	});
});

describe('splitSentences', () => {
	it('does not split on degree abbreviations', () => {
		expect(
			splitSentences('Restricted to students in the B.Kin. program with fourth-year standing.')
		).toHaveLength(1);
	});

	it('splits between a course list and a following sentence', () => {
		expect(splitSentences('One of BIOL 233, BIOL 234. BIOL 325 is recommended.')).toEqual([
			'One of BIOL 233, BIOL 234',
			'BIOL 325 is recommended.'
		]);
	});
});
