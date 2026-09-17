/**
 * Splits a raw `field_course_description` into its named sections.
 *
 * The calendar's dedicated prerequisite/corequisite/equivalency fields are null
 * for every course in the corpus, so all requirement data has to be recovered
 * from this one prose string.
 *
 * Two ordering hazards, both verified against live data, drive the design:
 *
 *   1. `Corequisite:` sometimes precedes `Prerequisite:` (3 of 600 sampled
 *      descriptions), so sections cannot be carved out left to right against a
 *      fixed order. We locate every marker by index and sort.
 *   2. "Credit will be granted for only one of X or Y." frequently appears
 *      mid-description, *before* the `[3-0-0]` hours vector — it is not a
 *      trailing section. We pull it out by sentence match anywhere, first.
 */
import type { CourseSections } from '../../src/lib/types.ts';

/**
 * Credit-exclusion sentences come in many phrasings. UBC varies the modal
 * ("will", "can", "cannot"), the negation, the word "only", and the verb
 * ("granted", "given", "applied", "allowed", "obtained"), so the pattern matches
 * the shape rather than any fixed wording.
 *
 * Getting this wrong invents prerequisites. Matching only "Credit will be
 * granted for only one of" left 80 statements in the clause, including
 * "Credit cannot be granted for both JRNL 440 and JRNL 540" - which parses as a
 * course requiring itself and its own alternative.
 */
/**
 * UBC embeds links mid-sentence, e.g. CPSC 320's prerequisite runs into
 * "... or any course on the STAT_V 200 credit exclusion: https://... or HES_O
 * 340, ...". A URL is never a requirement, so it is lifted into the notes
 * before parsing rather than being tokenized into the clause.
 */
const EMBEDDED_URL = /https?:\/\/\S+/g;

const CREDIT_EXCLUSION =
	/Credit\s+(?:will|can|cannot|may|shall|is)\s+(?:not\s+)?(?:only\s+)?be\s+(?:granted|given|applied|allowed|obtained|awarded)[^.]*\.?/gi;
const HOURS_VECTOR = /\[\s*(\d[\d\-;\s.*]*)\]/;
const MARKER = /\b(Prerequisites?|Corequisites?|Equivalenc(?:y|ies)|Recommended)\s*:/g;

/**
 * Sentences that live inside a requirement clause but state no requirement.
 * Deliberately narrow: "3rd-year class standing ... is required." IS a
 * requirement, so matching on "required" would discard real data.
 */
const NOTE_PATTERNS = [/\brecommended\b/i, /\bmay be waived\b/i, /^\s*Note\b/i];

/**
 * Splits on sentence boundaries without breaking abbreviations.
 *
 * The period must follow a lowercase letter, digit, `)`, `%` or `]` and precede
 * a capital. That keeps "B.Kin. program" and "B.Sc." intact (the following word
 * is lowercase) while still splitting "...BIOL 234. BIOL 325 is recommended."
 */
export function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[a-z0-9)%\]])\.\s+(?=[A-Z])/)
		.map((sentence) => sentence.trim())
		.filter(Boolean);
}

function isNote(sentence: string): boolean {
	return NOTE_PATTERNS.some((pattern) => pattern.test(sentence));
}

/** Pulls note sentences out of a requirement clause, returning the clause and the notes. */
function stripNotes(clause: string): { text: string | null; notes: string[] } {
	const sentences = splitSentences(clause);
	const notes: string[] = [];
	const kept: string[] = [];

	for (const sentence of sentences) {
		if (isNote(sentence)) notes.push(sentence);
		else kept.push(sentence);
	}

	const text = kept.join('. ').trim().replace(/\.*$/, '');
	return { text: text || null, notes };
}

export function segmentDescription(raw: string | null | undefined): CourseSections {
	const empty: CourseSections = {
		descriptionText: '',
		hoursVector: null,
		prerequisiteText: null,
		corequisiteText: null,
		equivalencyText: null,
		creditExclusionText: null,
		notes: []
	};
	if (!raw?.trim()) return empty;

	let text = raw.trim();

	const links: string[] = [];
	text = text.replace(EMBEDDED_URL, (match) => {
		links.push(match.replace(/[.,;]+$/, ''));
		return ' ';
	});

	// 1. Credit exclusions, wherever they sit — a description can carry more than
	//    one, and they often appear mid-prose rather than at the end.
	const exclusions: string[] = [];
	text = text.replace(CREDIT_EXCLUSION, (match) => {
		exclusions.push(match.replace(/\.$/, '').trim());
		return ' ';
	});
	if (exclusions.length) empty.creditExclusionText = exclusions.join(' ');

	// 2. Hours vector.
	const hours = HOURS_VECTOR.exec(text);
	if (hours) {
		empty.hoursVector = hours[1].trim();
		text = `${text.slice(0, hours.index)} ${text.slice(hours.index + hours[0].length)}`;
	}

	// 3. Requirement markers, located by index so order doesn't matter.
	const markers = [...text.matchAll(MARKER)].map((match) => ({
		label: match[1].toLowerCase(),
		start: match.index,
		end: match.index + match[0].length
	}));

	empty.descriptionText = (markers.length ? text.slice(0, markers[0].start) : text)
		.replace(/\s+/g, ' ')
		.trim();

	const notes: string[] = [];

	markers.forEach((marker, index) => {
		const next = markers[index + 1];
		const clause = text
			.slice(marker.end, next ? next.start : undefined)
			.replace(/\s+/g, ' ')
			.trim();
		if (!clause) return;

		if (marker.label.startsWith('equivalenc')) {
			empty.equivalencyText = clause.replace(/\.$/, '');
			return;
		}
		if (marker.label === 'recommended') {
			notes.push(`Recommended: ${clause.replace(/\.$/, '')}`);
			return;
		}

		const { text: cleaned, notes: clauseNotes } = stripNotes(clause);
		notes.push(...clauseNotes);
		if (marker.label.startsWith('pre')) empty.prerequisiteText = cleaned;
		else empty.corequisiteText = cleaned;
	});

	empty.notes = [...notes, ...links.map((link) => `See: ${link}`)];
	return empty;
}
