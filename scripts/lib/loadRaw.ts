/** Reads the gzipped JSON:API snapshot written by `scripts/scrape.ts`. */
import { gunzipSync } from 'node:zlib';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Document, Resource } from './jsonapi.ts';

export interface RawSnapshot {
	courses: Resource<CourseAttributes>[];
	subjects: Resource<SubjectAttributes>[];
	/** Sideloaded faculty/department/school terms, keyed by resource id. */
	terms: Map<string, string>;
	meta: { fetchedAt: string; courses: { count: number }; subjects: { count: number } };
}

export interface CourseAttributes {
	title: string;
	field_course_title: string | null;
	field_course_number: number | null;
	field_computed_course_number: string | null;
	field_course_credit: string | null;
	field_course_description: string | null;
	field_course_vector: string | null;
	field_course_crdfail: boolean | null;
	path: { alias: string } | null;
}

export interface SubjectAttributes {
	name: string;
	field_tax_subject_title: string | null;
	path: { alias: string } | null;
}

async function readPages<A>(dir: string, prefix: string): Promise<Document<A>[]> {
	const files = (await readdir(dir))
		.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.json.gz'))
		.sort();
	return Promise.all(
		files.map(
			async (file) =>
				JSON.parse(gunzipSync(await readFile(join(dir, file))).toString()) as Document<A>
		)
	);
}

export async function loadRaw(dir = 'data/raw'): Promise<RawSnapshot> {
	const [coursePages, subjectPages, metaText] = await Promise.all([
		readPages<CourseAttributes>(dir, 'courses'),
		readPages<SubjectAttributes>(dir, 'subjects'),
		readFile(join(dir, 'meta.json'), 'utf8')
	]);

	const terms = new Map<string, string>();
	for (const page of subjectPages) {
		for (const included of page.included ?? []) {
			const name = (included.attributes as { name?: string }).name;
			if (name) terms.set(included.id, name);
		}
	}

	return {
		courses: coursePages.flatMap((page) => page.data),
		subjects: subjectPages.flatMap((page) => page.data),
		terms,
		meta: JSON.parse(metaText)
	};
}
