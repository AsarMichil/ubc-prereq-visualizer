/**
 * Recognises a reference to a credit exclusion list: "any course on the STAT_V
 * 200 credit exclusion list".
 *
 * UBC publishes these lists as separate pages, and the calendar links to them
 * inline. The scrape keeps the link text but drops the href, so what reaches the
 * parser is a sentence with a course code sitting in the middle of it.
 *
 * Read naively that code looks like a prerequisite, which is exactly backwards:
 * it names the *list*, not a course you have to take. In CPSC 320 that turned
 * "or any course on the STAT_V 200 credit exclusion" into a mandatory STAT 200,
 * AND-ed alongside the alternatives it was supposed to be one of, and left the
 * words "any course on the" stranded as their own condition.
 *
 * Only 2 clauses in the corpus phrase a requirement this way, but both were
 * wrong in the same way, and both are large multi-branch clauses where the
 * damage is hard to spot.
 */
import { parseCourseCode, type ParsedCode } from './normalizeCode.ts';

export interface CreditExclusionRef {
	/** The course naming the list. */
	course: ParsedCode;
	/** Length of the matched text, so the tokenizer knows how far to advance. */
	length: number;
	raw: string;
}

/**
 * The trailing colon is part of the match: it is the debris of the stripped
 * hyperlink ("credit exclusion: <a href=...>list</a>"), and leaving it behind
 * would start the next atom with punctuation.
 */
const PATTERN =
	/^(?:[Aa]ny|[Aa]ll)?\s*[Cc]ourses?\s+on\s+the\s+([A-Z]{2,5}(?:_[VO])?\s*\d{1,3}[A-Z]?)\s+[Cc]redit\s+[Ee]xclusion(?:\s+[Ll]ists?)?\s*:?/;

/**
 * Matches a credit exclusion reference at the start of `text`, or returns null.
 *
 * Anchored so the tokenizer can use it positionally, the same way credit
 * requirements are matched.
 */
export function matchCreditExclusion(text: string): CreditExclusionRef | null {
	const match = PATTERN.exec(text);
	if (!match) return null;

	const course = parseCourseCode(match[1]);
	// A two-digit number here would be a high-school course, which never names a
	// credit exclusion list; treat that as prose rather than inventing a node.
	if (!course || course.isHighSchool) return null;

	return { course, length: match[0].length, raw: match[0].trim() };
}
