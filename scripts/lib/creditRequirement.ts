/**
 * Recognises credit requirements: "at least 3 credits from MATH_V or STAT_V at
 * 200 level or above", "6 credits of 300-level VISA_V", "24 credits in MATH".
 *
 * These are quantities drawn from a set defined by subject and level, not lists
 * of courses, so they cannot be represented as a disjunction of specific
 * courses. Before this they fell through to free text, and in CPSC 320's case
 * the surrounding prose was mangled: the clause enumerates Okanagan
 * alternatives, so stripping those left "at least 3 credits from MATH_V or
 * STAT_V at 200 level or above or any course on the".
 *
 * 23 of the corpus's 83 credit clauses state a subject and optionally a level
 * this precisely. The rest are prose ("3 credits of science", "6 credits of
 * literature") and stay free text, since there is nothing to match them against.
 */

export interface CreditRequirement {
	count: number;
	subjects: string[];
	minLevel: number | null;
	/** Length of the matched text, so the tokenizer knows how far to advance. */
	length: number;
	raw: string;
}

/** "6 credits of 300-level VISA_V" - the level precedes the subject. */
const LEVEL_FIRST =
	/^(?:at least\s+|a minimum of\s+|an additional\s+)?(\d+)\s+credits?\s+(?:of|from|in)\s+(\d{3})[\s-]*level\s+([A-Z]{2,5}(?:_[VO])?)\b(?!(?:_[VO])?\s*\d)/;

/**
 * "3 credits from MATH_V or STAT_V at 200 level or above" - one or more
 * subjects, then an optional level floor.
 *
 * The word boundary matters as much as the lookahead. Without it the subject
 * group backtracks to any prefix that makes the lookahead pass - "ARCH_V 504"
 * matched as subject "ARC" - and a list of specific courses was read as a
 * subject quota, silently dropping those courses from the graph. `\b` blocks
 * that because a letter is never a boundary against another letter or "_".
 */
const SUBJECTS_FIRST =
	/^(?:at least\s+|a minimum of\s+|an additional\s+)?(\d+)\s+credits?\s+(?:of|from|in)\s+([A-Z]{2,5}(?:_[VO])?(?:\s*(?:,|or|and)\s*[A-Z]{2,5}(?:_[VO])?)*)\b(?!(?:_[VO])?\s*\d)(?:\s+courses?)?(?:\s+(?:at|numbered)\s+(\d{3})[\s-]*level(?:\s+or\s+(?:above|higher))?)?/;

const normalise = (subject: string) => subject.replace(/_[VO]$/, '');

/**
 * Matches a credit requirement at the start of `text`, or returns null.
 *
 * Anchored so the tokenizer can use it positionally rather than searching, which
 * keeps it from matching a credit phrase buried later in the clause.
 */
export function matchCreditRequirement(text: string): CreditRequirement | null {
	const levelFirst = LEVEL_FIRST.exec(text);
	if (levelFirst) {
		return {
			count: Number(levelFirst[1]),
			subjects: [normalise(levelFirst[3])],
			minLevel: Number(levelFirst[2]),
			length: levelFirst[0].length,
			raw: levelFirst[0].trim()
		};
	}

	const subjectsFirst = SUBJECTS_FIRST.exec(text);
	if (subjectsFirst) {
		const subjects = (subjectsFirst[2].match(/[A-Z]{2,5}(?:_[VO])?/g) ?? []).map(normalise);
		if (subjects.length === 0) return null;
		return {
			count: Number(subjectsFirst[1]),
			subjects: [...new Set(subjects)],
			minLevel: subjectsFirst[3] ? Number(subjectsFirst[3]) : null,
			length: subjectsFirst[0].length,
			raw: subjectsFirst[0].trim()
		};
	}

	return null;
}
