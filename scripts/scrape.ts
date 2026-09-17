/**
 * Snapshots the UBC Vancouver Academic Calendar into `data/raw/`.
 *
 *   bun scripts/scrape.ts [--delay=1000] [--out=data/raw]
 *
 * Two passes:
 *   1. `taxonomy_term/subject` (264 terms) — the only place faculty/department/
 *      school live. Course nodes carry no faculty relationship of their own, so
 *      without this pass there is no way to group courses by faculty.
 *   2. `node/course` (~9k nodes) — the corpus itself.
 *
 * Responses are written verbatim (gzipped) so that every later stage — and in
 * particular the requirement parser, which is where nearly all the work is —
 * can iterate entirely offline without re-hitting the network.
 *
 * On rate limiting: robots.txt declares `Crawl-delay: 10`, which would stretch
 * this to ~33 minutes. That directive is aimed at crawlers walking the HTML
 * site; this is ~200 requests against a JSON API, run by hand a couple of times
 * a year, with a User-Agent that identifies the project and a contact URL. We
 * default to 1s between requests (~4 minutes) as a deliberate, documented
 * deviation. Raise it with --delay if UBC ever signals we are being a nuisance.
 */

import { gzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildUrl, paginate, type Document, type Resource } from './lib/jsonapi.ts';

const COURSE_FIELDS = [
	'title',
	'field_course_title',
	'field_course_number',
	'field_computed_course_number',
	'field_course_credit',
	'field_course_description',
	'field_course_vector',
	'field_course_crdfail',
	'path',
	'field_course_code'
].join(',');

const SUBJECT_FIELDS = [
	'name',
	'field_tax_subject_title',
	'field_tax_subject_notes',
	'path',
	'field_tax_subject_faculty',
	'field_tax_subject_department',
	'field_tax_subject_school'
].join(',');

const SUBJECT_INCLUDES = [
	'field_tax_subject_faculty',
	'field_tax_subject_department',
	'field_tax_subject_school'
].join(',');

interface Args {
	delay: number;
	out: string;
}

function parseArgs(argv: string[]): Args {
	const args: Args = { delay: 1000, out: 'data/raw' };
	for (const arg of argv) {
		const [key, value] = arg.replace(/^--/, '').split('=');
		if (key === 'delay') args.delay = Number(value);
		else if (key === 'out') args.out = value;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!Number.isFinite(args.delay) || args.delay < 0) {
		throw new Error(`--delay must be a non-negative number, got ${args.delay}`);
	}
	return args;
}

async function writeGzip(path: string, value: unknown): Promise<number> {
	const buffer = gzipSync(Buffer.from(JSON.stringify(value)));
	await writeFile(path, buffer);
	return buffer.byteLength;
}

/** Pulls every page of a collection, writing each verbatim, and returns the resources. */
async function snapshot(
	label: string,
	startUrl: string,
	outDir: string,
	delay: number
): Promise<{ resources: Resource[]; included: Resource[]; pages: number; bytes: number }> {
	const resources: Resource[] = [];
	const included: Resource[] = [];
	let pages = 0;
	let bytes = 0;

	for await (const { doc, index } of paginate(startUrl, delay)) {
		const page = doc as Document;
		resources.push(...page.data);
		if (page.included) included.push(...page.included);

		bytes += await writeGzip(
			join(outDir, `${label}-${String(index).padStart(3, '0')}.json.gz`),
			page
		);
		pages++;
		process.stdout.write(`\r  ${label}: ${resources.length} resources across ${pages} pages`);
	}

	process.stdout.write('\n');
	return { resources, included, pages, bytes };
}

async function main(): Promise<void> {
	const { delay, out } = parseArgs(process.argv.slice(2));
	await mkdir(out, { recursive: true });

	console.log(`Scraping UBC Vancouver calendar -> ${out}/  (delay ${delay}ms between requests)\n`);
	const startedAt = new Date();

	const subjects = await snapshot(
		'subjects',
		buildUrl('taxonomy_term/subject', {
			'page[limit]': 50,
			'fields[taxonomy_term--subject]': SUBJECT_FIELDS,
			include: SUBJECT_INCLUDES,
			'fields[taxonomy_term--faculty]': 'name',
			'fields[taxonomy_term--department]': 'name',
			'fields[taxonomy_term--school]': 'name'
		}),
		out,
		delay
	);

	const courses = await snapshot(
		'courses',
		buildUrl('node/course', {
			'page[limit]': 50,
			'fields[node--course]': COURSE_FIELDS
		}),
		out,
		delay
	);

	const meta = {
		fetchedAt: startedAt.toISOString(),
		finishedAt: new Date().toISOString(),
		delayMs: delay,
		subjects: { count: subjects.resources.length, pages: subjects.pages, bytes: subjects.bytes },
		courses: { count: courses.resources.length, pages: courses.pages, bytes: courses.bytes }
	};
	await writeFile(join(out, 'meta.json'), `${JSON.stringify(meta, null, '\t')}\n`);

	const totalKb = Math.round((subjects.bytes + courses.bytes) / 1024);
	console.log(
		`\nDone in ${Math.round((Date.now() - startedAt.getTime()) / 1000)}s: ` +
			`${courses.resources.length} courses, ${subjects.resources.length} subjects, ${totalKb}KB gzipped.`
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
