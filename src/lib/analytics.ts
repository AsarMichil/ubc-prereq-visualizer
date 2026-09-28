/**
 * Anonymous usage events, posted straight to Supabase.
 *
 * The app is prerendered to static files and Vercel runs no functions, so there
 * is no server to proxy through - the browser talks to PostgREST directly with
 * the publishable key. `supabase/schema.sql` has the table, the row-level
 * security that makes it write-only, and the kill switch.
 *
 * No SDK: `@supabase/supabase-js` is ~50KB to do what four lines of `fetch`
 * does here, and this app already asks the browser to download ~7MB of course
 * data before it can show anything.
 *
 * What is collected is two random ids and the eight events below. No cookies,
 * no IP, no accounts, and never the text someone typed into the search box -
 * only the course code they picked, which is public calendar data. `/about`
 * covers what is not collected; the exhaustive list is the CHECK constraint in
 * supabase/schema.sql rather than anything user-facing.
 */
import { browser } from '$app/environment';
// A namespace import, not a named one: these are unset locally and in CI, and
// importing a named export that does not exist fails the build. Same reasoning
// as PUBLIC_FLAGS in flags.svelte.ts.
import * as publicEnv from '$env/static/public';

const env = publicEnv as Record<string, string | undefined>;
const SUPABASE_URL = env.PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Off unless it is deliberately switched on.
 *
 * The keys are set in Vercel's production environment only, so preview
 * deployments, `bun run dev` and the test run are inert by construction rather
 * than by remembering to guard each call. `webdriver` keeps automated browsers
 * out of the numbers.
 */
const enabled = browser && !!SUPABASE_URL && !!SUPABASE_PUBLISHABLE_KEY && !navigator.webdriver;

/** The vocabulary is fixed by a CHECK constraint; adding one here needs both. */
export type EventName =
	| 'session_start'
	| 'session_end'
	| 'search_select'
	| 'course_added'
	| 'expand'
	| 'course_removed'
	| 'builder_cleared'
	| 'map_load_failed';

export type TrackFn = (name: EventName, props?: Record<string, unknown>) => void;

const VISITOR_KEY = 'ubc-prereq:visitor';
const SESSION_KEY = 'ubc-prereq:session';

/**
 * A random id, remembered where it was asked for.
 *
 * Storage can throw outright in private browsing or with site data blocked, and
 * an id is never worth failing a page load over - the fallback is a fresh id
 * that lasts as long as the page does, which costs one over-counted visitor.
 */
function persistentId(storage: () => Storage, key: string): string {
	try {
		const store = storage();
		const existing = store.getItem(key);
		if (existing) return existing;
		const fresh = crypto.randomUUID();
		store.setItem(key, fresh);
		return fresh;
	} catch {
		return crypto.randomUUID();
	}
}

let visitorId = '';
let sessionId = '';
let startedAt = 0;

export const track: TrackFn = (name, props = {}) => {
	if (!enabled || !sessionId) return;

	// Fire and forget. Analytics failing is not the user's problem, so nothing
	// here is awaited and nothing surfaces - not even to the console, which on a
	// blocked request would otherwise be noise on every single event.
	fetch(`${SUPABASE_URL}/rest/v1/events`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			// `apikey` alone, deliberately. `Authorization` is where a signed-in
			// user's JWT goes, and there is never one here - putting the key there
			// too is a legacy convention that a modern `sb_publishable_...` key,
			// which is not a JWT, would be rejected for. Without the header the
			// request resolves to the `anon` role either way, which is what the
			// grants and the policy in supabase/schema.sql are written against.
			apikey: SUPABASE_PUBLISHABLE_KEY!,
			// Without this PostgREST tries to return the inserted row, which needs a
			// SELECT that `anon` deliberately does not have - so the insert fails.
			prefer: 'return=minimal'
		},
		body: JSON.stringify({ visitor_id: visitorId, session_id: sessionId, name, props }),
		// Lets the request outlive the page, which is the whole point for
		// `session_end`. `sendBeacon` cannot set headers, so it would mean putting
		// the key in the query string and losing `prefer` above.
		keepalive: true
	}).catch(() => {});
};

/**
 * Opens the session and arranges for it to be closed.
 *
 * Returns a teardown, so it drops into an `onMount` return alongside the other
 * listeners the page already cleans up.
 *
 * `snapshot` is called at the end to record what the user actually built. It is
 * a callback rather than a value because the interesting numbers only exist at
 * pagehide, and the page owns the builder that knows them.
 */
export function startSession(snapshot: () => Record<string, unknown>): () => void {
	if (!enabled) return () => {};

	visitorId = persistentId(() => localStorage, VISITOR_KEY);
	sessionId = persistentId(() => sessionStorage, SESSION_KEY);
	startedAt = Date.now();

	track('session_start', {
		// Host only. A full referrer can carry a search query or a private URL,
		// and "where did they come from" only needs the site.
		referrer_host: referrerHost(),
		viewport: viewportBucket()
	});

	// `pagehide` rather than `beforeunload`, which browsers increasingly skip for
	// a page restored from the back/forward cache, and `visibilitychange` alone
	// would fire on every tab switch.
	let ended = false;
	const end = () => {
		if (ended) return;
		ended = true;
		track('session_end', {
			seconds: Math.round((Date.now() - startedAt) / 1000),
			...snapshot()
		});
	};

	window.addEventListener('pagehide', end);
	return () => window.removeEventListener('pagehide', end);
}

function referrerHost(): string {
	try {
		if (!document.referrer) return '';
		const host = new URL(document.referrer).host;
		return host === location.host ? '' : host;
	} catch {
		return '';
	}
}

/** Coarse enough to be useless for identifying anyone, precise enough to tell
 * whether students are on a phone. */
function viewportBucket(): 'sm' | 'md' | 'lg' {
	if (window.innerWidth < 640) return 'sm';
	return window.innerWidth < 1024 ? 'md' : 'lg';
}
