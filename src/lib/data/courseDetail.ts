/**
 * Lazily fetches per-course detail, cached by subject.
 *
 * Full descriptions and requirement trees are far too large to ship with the
 * map payload, so they live in one file per subject and are pulled in on
 * demand. A plain Map is correct here: it is a fetch cache, not UI state.
 */
import type { CourseCode, CreditRange, RequirementNode } from '../types';

export interface CourseDetail {
	title: string;
	description: string;
	hours: string | null;
	credits: CreditRange;
	prerequisite: RequirementNode | null;
	corequisite: RequirementNode | null;
	prerequisiteText: string | null;
	corequisiteText: string | null;
	notes: string[];
	equivalentTo: CourseCode[];
	creditExcludedWith: CourseCode[];
	url: string;
}

const bundles = new Map<string, Promise<Record<string, CourseDetail>>>();
/** Resolved bundles, so callers that cannot await can still read what is loaded. */
const loaded = new Map<string, Record<string, CourseDetail>>();

function subjectOf(code: CourseCode): string {
	return code.split(/\s+/)[0];
}

export function loadSubject(subject: string): Promise<Record<string, CourseDetail>> {
	let bundle = bundles.get(subject);
	if (!bundle) {
		bundle = fetch(`/data/courses/${subject}.json`)
			.then((response) => (response.ok ? response.json() : {}))
			.catch(() => ({}))
			.then((data: Record<string, CourseDetail>) => {
				loaded.set(subject, data);
				return data;
			});
		bundles.set(subject, bundle);
	}
	return bundle;
}

export async function getCourse(code: CourseCode): Promise<CourseDetail | null> {
	const bundle = await loadSubject(subjectOf(code));
	return bundle[code] ?? null;
}

/**
 * Reads an already-loaded course without awaiting.
 *
 * Returns undefined when the subject has not finished loading, which callers
 * must treat as "not known yet" rather than "has no prerequisites".
 */
export function peekCourse(code: CourseCode): CourseDetail | null | undefined {
	const bundle = loaded.get(subjectOf(code));
	if (!bundle) return undefined;
	return bundle[code] ?? null;
}

/** Warms the cache for several courses at once, de-duplicated by subject. */
export async function preloadSubjects(codes: Iterable<CourseCode>): Promise<void> {
	const subjects = new Set([...codes].map(subjectOf));
	await Promise.all([...subjects].map(loadSubject));
}
