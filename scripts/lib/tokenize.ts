/**
 * Tokenizer for UBC requirement clauses.
 *
 * The input is natural language, so the tokenizer's job is to recognize the
 * handful of constructs that carry logical meaning (quantifiers, alternatives,
 * grade thresholds, course codes) and lump everything else into WORD runs that
 * the parser can fold into a free-text condition.
 */
import { parseCourseCode, type ParsedCode } from './normalizeCode.ts';

export type TokenType =
	| 'QUANT'
	| 'EITHER'
	| 'LABEL'
	| 'LPAREN'
	| 'RPAREN'
	| 'GRADE'
	| 'COURSE'
	| 'HS_COURSE'
	| 'AND'
	| 'OR'
	| 'COMMA'
	| 'SEMI'
	| 'NUMBER'
	| 'WORD';

export interface Token {
	type: TokenType;
	raw: string;
	start: number;
	/** QUANT: how many are required; 'all' for "All of". */
	quantity?: number | 'all';
	/** COURSE: the normalized reference. */
	course?: ParsedCode;
	/** GRADE: the threshold this prefix imposes on whatever follows "in". */
	grade?: { min: number; unit: 'percent' | 'grade' };
	/** NUMBER: a bare course number continuing an earlier subject ("MATH 100, 102"). */
	value?: string;
}

const WORD_TO_COUNT: Record<string, number | 'all'> = {
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	both: 'all',
	all: 'all'
};

/**
 * Grade thresholds. Modelled as a *prefix* operator ending in "in", because the
 * thing being graded is not always a single course — "a score of 68% or higher
 * in one of MATH 215, MATH 255, MATH 256" grades a whole disjunction.
 */
const GRADE = new RegExp(
	'(?:\\ba\\s+)?(?:combined\\s+)?(?:score|average|grade|mark)\\s+of\\s+(?:at\\s+least\\s+)?' +
		'(\\d{1,3})\\s*%\\s*(?:or\\s+(?:higher|better|greater|above))?\\s+in\\s+' +
		'|(\\d{1,3})\\s*%\\s+in\\s+',
	'iy'
);

/** BC secondary-school courses named in words rather than as codes. */
const HS_NAMED = new RegExp(
	'\\b(?:BC\\s+)?(?:Principles of Mathematics|Foundations of Mathematics|Pre-?calculus|Calculus|Physics|' +
		'Chemistry|Biology|English|French|Computer Science|Mathematics)\\s+1[0-2]\\b',
	'iy'
);

const PATTERNS: [TokenType, RegExp][] = [
	// Quantifiers first: "One of" must not tokenize as WORD("One") + WORD("of").
	// The word "of" is optional in two cases UBC actually writes:
	//   "both (a) AI 240 and (b) one of ..."   quantifier straight onto a label
	//   "both CHEM 121 and CHEM 123"           quantifier straight onto a course
	// Only "both"/"all" may drop the "of" before a course, because "one CPSC 110"
	// is not a quantifier phrase whereas "both CPSC 110 and ..." is.
	[
		'QUANT',
		/\b(one|two|three|four|five|six|both|all)\s+of\b|\b(both|all)\s+(?=\(?[a-z]\)|[A-Z]{2,5}(?:_[VO])?\s*\d)|\b(one|two|three|four|five|six)\s+(?=\(?[a-z]\))/iy
	],
	['EITHER', /\beither\b/iy],
	// Labelled alternatives must be tried before a bare "(". The calendar writes
	// both "(a)" and a bare "a)".
	['LABEL', /\(\s*[a-z]\s*\)|\b[a-z]\)/iy],
	['LPAREN', /\(/y],
	['RPAREN', /\)/y],
	['GRADE', GRADE],
	['HS_COURSE', HS_NAMED],
	// The separator is optional: the calendar writes both "FILM 433" and "FILM433".
	['COURSE', /\b[A-Z]{2,5}(?:_[VO])?\s*\d{1,3}[A-Z]?\b/y],
	['AND', /\band\b/iy],
	// "LING 201/PHIL 220/PHIL 222" — a slash between codes means alternatives.
	['OR', /\bor\b|\//iy],
	['COMMA', /,/y],
	['SEMI', /;/y],
	// A bare number continues the previous subject: "One of MATH 100, 102, 104".
	['NUMBER', /\d{1,3}[A-Z]?\b/y],
	// A sentence-ending period is a soft separator. Placed after WORD-forming
	// rules would be wrong, but it can only match at a token start, so
	// abbreviations like "B.Kin." are still swallowed whole by WORD below.
	['SEMI', /\.(?=\s|$)/y],
	['WORD', /[^\s,;()]+/y]
];

export function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	let pos = 0;

	while (pos < input.length) {
		// Square brackets appear around stray codes ("[ANTH341]") and carry no
		// meaning of their own; treat them as whitespace so the code inside is seen.
		if (/[\s[\]]/.test(input[pos])) {
			pos++;
			continue;
		}

		let matched = false;

		for (const [type, pattern] of PATTERNS) {
			pattern.lastIndex = pos;
			const match = pattern.exec(input);
			if (!match) continue;

			const token: Token = { type, raw: match[0], start: pos };

			if (type === 'QUANT') {
				const word = (match[1] ?? match[2] ?? match[3]).toLowerCase();
				token.quantity = WORD_TO_COUNT[word];
			} else if (type === 'GRADE') {
				token.grade = { min: Number(match[1] ?? match[2]), unit: 'percent' };
			} else if (type === 'NUMBER') {
				token.value = match[0];
			} else if (type === 'COURSE') {
				const course = parseCourseCode(match[0]);
				// A bare all-caps word followed by digits that isn't a valid code
				// (shouldn't happen, but never silently mis-type it).
				if (!course) continue;
				token.type = course.isHighSchool ? 'HS_COURSE' : 'COURSE';
				token.course = course;
			}

			tokens.push(token);
			pos += match[0].length;
			matched = true;
			break;
		}

		// Nothing matched (e.g. a stray symbol); skip one char rather than loop forever.
		if (!matched) pos++;
	}

	return tokens;
}
