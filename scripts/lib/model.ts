/** Turns the raw JSON:API snapshot into the normalized course/subject model. */
import type { Course, CreditRange, RequirementNode, Subject } from '../../src/lib/types.ts';
import type { RawSnapshot } from './loadRaw.ts';
import { extractCourseCodes, parseCourseCode } from './normalizeCode.ts';
import { parseRequirement } from './parseRequirement.ts';
import { segmentDescription } from './segmentDescription.ts';

const CALENDAR_ORIGIN = 'https://vancouver.calendar.ubc.ca';

/** "(3)" -> {min:3,max:3}; "(3-6)" -> {min:3,max:6}; "(1.5)" -> {min:1.5,max:1.5}. */
export function parseCredits(raw: string | null): CreditRange {
	const match = /\(?\s*(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*\)?/.exec(raw ?? '');
	if (!match) return { min: 0, max: 0 };
	const min = Number(match[1]);
	return { min, max: match[2] ? Number(match[2]) : min };
}

/** Course titles usually come from a dedicated field but fall back to the node title. */
function courseTitle(attributes: { field_course_title: string | null; title: string }): string {
	if (attributes.field_course_title?.trim()) return attributes.field_course_title.trim();
	const match = /:\s*(.+)$/.exec(attributes.title ?? '');
	return match ? match[1].trim() : (attributes.title ?? '').trim();
}

export interface BuildModelResult {
	subjects: Map<string, Subject>;
	courses: Course[];
	/** Course nodes skipped because they carry no subject (malformed calendar rows). */
	skipped: number;
}

export function buildModel(raw: RawSnapshot): BuildModelResult {
	// Subject term uuid -> Subject, so a course's field_course_code can be resolved.
	const byUuid = new Map<string, Subject>();
	const subjects = new Map<string, Subject>();

	for (const term of raw.subjects) {
		const name = term.attributes.name ?? '';
		const code = name.replace(/_[VO]$/, '');
		if (!code) continue;

		const related = (key: string): string | null => {
			const data = term.relationships?.[key]?.data;
			if (!data || Array.isArray(data)) return null;
			return raw.terms.get(data.id) ?? null;
		};

		const subject: Subject = {
			code,
			title: term.attributes.field_tax_subject_title?.trim() || code,
			faculty: related('field_tax_subject_faculty'),
			department: related('field_tax_subject_department'),
			school: related('field_tax_subject_school')
		};

		byUuid.set(term.id, subject);
		subjects.set(code, subject);
	}

	const courses: Course[] = [];
	const seen = new Set<string>();
	let skipped = 0;

	for (const node of raw.courses) {
		const relation = node.relationships?.field_course_code?.data;
		const subjectRef = relation && !Array.isArray(relation) ? byUuid.get(relation.id) : null;
		const numberLabel = (node.attributes.field_computed_course_number ?? '').trim();

		// ~1 in 600 calendar rows is malformed (title "- 447:", no subject term).
		if (!subjectRef || !numberLabel) {
			skipped++;
			continue;
		}

		const parsed = parseCourseCode(`${subjectRef.code} ${numberLabel}`);
		if (!parsed || seen.has(parsed.code)) {
			skipped++;
			continue;
		}
		seen.add(parsed.code);

		const sections = segmentDescription(node.attributes.field_course_description);
		const prerequisite = parseRequirement(sections.prerequisiteText);
		const corequisite = parseRequirement(sections.corequisiteText);

		courses.push({
			code: parsed.code,
			subject: subjectRef.code,
			number: parsed.number,
			numberLabel: parsed.numberLabel,
			title: courseTitle(node.attributes),
			credits: parseCredits(node.attributes.field_course_credit),
			sections,
			prerequisite,
			corequisite,
			equivalentTo: extractCourseCodes(sections.equivalencyText ?? ''),
			creditExcludedWith: extractCourseCodes(sections.creditExclusionText ?? ''),
			url: node.attributes.path?.alias ? `${CALENDAR_ORIGIN}${node.attributes.path.alias}` : ''
		});
	}

	courses.sort((a, b) => a.code.localeCompare(b.code));
	return { subjects, courses, skipped };
}

export interface RequirementRef {
	code: string;
	/** Set when the reference sits inside a "one of"/"two of", marking alternatives. */
	groupId: string | null;
}

/**
 * Every course reference in a requirement tree, tagged with the disjunction it
 * belongs to. The group tag is what lets the renderer draw alternatives as a
 * dashed set rather than as independent mandatory edges.
 */
export function* iterateRefs(
	node: RequirementNode | null,
	prefix: string,
	group: string | null = null
): Generator<RequirementRef> {
	if (!node) return;

	switch (node.kind) {
		// A course is always on its own credit exclusion list, so the named course
		// is a genuine way to satisfy the requirement - it just is not the only
		// one, and it is never mandatory on its own.
		case 'course':
		case 'creditExclusion':
			yield { code: node.code, groupId: group };
			break;
		case 'unparsed':
			for (const code of node.mentionedCodes) yield { code, groupId: group };
			break;
		case 'withGrade':
			yield* iterateRefs(node.child, prefix, group);
			break;
		case 'all':
			for (const child of node.children) yield* iterateRefs(child, prefix, group);
			break;
		case 'oneOf':
		case 'nOf':
			for (const child of node.children) {
				yield* iterateRefs(child, prefix, `${prefix}:${node.groupId}`);
			}
			break;
	}
}
