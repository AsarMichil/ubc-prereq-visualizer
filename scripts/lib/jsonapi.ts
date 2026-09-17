/**
 * Minimal client for the UBC Academic Calendar's public Drupal JSON:API.
 *
 * Base: https://vancouver.calendar.ubc.ca/jsonapi
 *
 * Notes on the upstream API, verified against the live service:
 *   - `page[limit]` is capped at 50. Asking for more silently returns 50, so
 *     never trust the requested size; follow `links.next` instead.
 *   - Responses are `application/vnd.api+json`.
 *   - Errors come back as a top-level `errors` array with a 200-ish envelope in
 *     some cases, so we check for it explicitly rather than relying on status.
 */

export const JSONAPI_BASE = 'https://vancouver.calendar.ubc.ca/jsonapi';

/** Identifies us to UBC so they can find a human if this ever misbehaves. */
export const USER_AGENT =
	'ubc-prereq-visualizer/0.1 (course prerequisite graph; +https://github.com/Asar-Michil/ubc-prereq-visualizer)';

export interface ResourceIdentifier {
	type: string;
	id: string;
	meta?: { drupal_internal__target_id?: number | string };
}

export interface Relationship {
	data?: ResourceIdentifier | ResourceIdentifier[] | null;
}

export interface Resource<A = Record<string, unknown>> {
	type: string;
	id: string;
	attributes: A;
	relationships?: Record<string, Relationship>;
}

export interface Document<A = Record<string, unknown>> {
	data: Resource<A>[];
	included?: Resource[];
	links?: { next?: { href: string }; self?: { href: string } };
	errors?: { status?: string; title?: string; detail?: string }[];
}

export class JsonApiError extends Error {}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a JSON:API URL. Bracketed params (`page[limit]`, `fields[node--course]`)
 * must be percent-encoded, which `URLSearchParams` handles for us.
 */
export function buildUrl(path: string, params: Record<string, string | number>): string {
	const url = new URL(`${JSONAPI_BASE}/${path}`);
	for (const [key, value] of Object.entries(params)) {
		url.searchParams.set(key, String(value));
	}
	return url.toString();
}

/** GETs a JSON:API document, retrying transient failures with exponential backoff. */
export async function fetchDocument<A>(url: string, maxAttempts = 5): Promise<Document<A>> {
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const response = await fetch(url, {
				headers: { Accept: 'application/vnd.api+json', 'User-Agent': USER_AGENT }
			});

			if (!response.ok) {
				if (!RETRYABLE_STATUS.has(response.status) || attempt === maxAttempts) {
					throw new JsonApiError(`${response.status} ${response.statusText} for ${url}`);
				}
				// Honour Retry-After when the server offers one.
				const retryAfter = Number(response.headers.get('retry-after'));
				const backoff =
					Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
				await sleep(backoff);
				continue;
			}

			const doc = (await response.json()) as Document<A>;
			if (doc.errors?.length) {
				throw new JsonApiError(`JSON:API error for ${url}: ${JSON.stringify(doc.errors)}`);
			}
			return doc;
		} catch (error) {
			lastError = error;
			if (error instanceof JsonApiError || attempt === maxAttempts) throw error;
			await sleep(2 ** attempt * 500);
		}
	}

	throw lastError instanceof Error ? lastError : new JsonApiError(String(lastError));
}

/**
 * Walks every page of a collection, yielding the raw document so callers can
 * persist responses verbatim. `delayMs` is applied *between* requests only.
 */
export async function* paginate<A>(
	startUrl: string,
	delayMs: number
): AsyncGenerator<{ doc: Document<A>; index: number }> {
	let url: string | undefined = startUrl;
	let index = 0;

	while (url) {
		const doc: Document<A> = await fetchDocument<A>(url);
		yield { doc, index };
		index++;

		url = doc.links?.next?.href;
		if (url && delayMs > 0) await sleep(delayMs);
	}
}
