/**
 * Feature flags.
 *
 * Two ways to set one, in order of precedence:
 *
 * 1. **The browser console**, for trying something out on a deployed build
 *    without redeploying it: `flags.enable('explore')`. Overrides persist in
 *    localStorage and affect only that browser, so an unfinished view can be
 *    shown to one person without shipping it to everyone.
 * 2. **`PUBLIC_FLAGS`**, a comma-separated list read at build time, for the
 *    real setting: `PUBLIC_FLAGS=explore`. Prefix a name with `-` to force it
 *    off. On Vercel this is a project environment variable, and changing it
 *    needs a redeploy - the app is prerendered to static files, so there is no
 *    server left to read an environment variable at request time.
 *
 * Anything not mentioned falls back to the default below.
 */
import { browser } from '$app/environment';
// A namespace import, not a named one: `PUBLIC_FLAGS` is usually unset, and
// importing a named export that does not exist fails the build.
import * as publicEnv from '$env/static/public';

export interface FlagDefinition {
	/** Value when nothing overrides it. */
	default: boolean;
	/** Shown by `flags.list()`, so it has to say what turning it on does. */
	description: string;
}

export const FLAGS = {
	explore: {
		default: false,
		description: 'The full-map explore view. Off until it is ready for users.'
	}
} as const satisfies Record<string, FlagDefinition>;

export type FlagName = keyof typeof FLAGS;

const FLAG_NAMES = Object.keys(FLAGS) as FlagName[];
const STORAGE_KEY = 'ubc-prereq:flags';

const isFlagName = (name: string): name is FlagName => (FLAG_NAMES as string[]).includes(name);

/** `"explore,-other"` -> `{ explore: true, other: false }`. Exported for tests. */
export function parseEnv(raw: string): Partial<Record<FlagName, boolean>> {
	const parsed: Partial<Record<FlagName, boolean>> = {};
	for (const token of raw.split(/[,\s]+/)) {
		if (!token) continue;
		const off = token.startsWith('-') || token.startsWith('!');
		const name = off ? token.slice(1) : token;
		if (isFlagName(name)) parsed[name] = !off;
	}
	return parsed;
}

const fromEnv = parseEnv((publicEnv as Record<string, string | undefined>).PUBLIC_FLAGS ?? '');

function readStored(): Partial<Record<FlagName, boolean>> {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') return {};
		const stored: Partial<Record<FlagName, boolean>> = {};
		for (const [name, value] of Object.entries(parsed)) {
			if (isFlagName(name) && typeof value === 'boolean') stored[name] = value;
		}
		return stored;
	} catch {
		// Private browsing, blocked storage, or something else wrote nonsense
		// here. A flag override is never worth failing a page load over.
		return {};
	}
}

class FeatureFlags {
	/**
	 * Per-browser overrides. Reactive, so flipping a flag in the console
	 * re-renders immediately instead of waiting for a reload.
	 */
	private overrides = $state<Partial<Record<FlagName, boolean>>>(readStored());

	enabled(name: FlagName): boolean {
		return this.overrides[name] ?? fromEnv[name] ?? FLAGS[name].default;
	}

	/** Where a flag's current value came from, for `list()`. */
	private sourceOf(name: FlagName): 'console' | 'PUBLIC_FLAGS' | 'default' {
		if (this.overrides[name] !== undefined) return 'console';
		if (fromEnv[name] !== undefined) return 'PUBLIC_FLAGS';
		return 'default';
	}

	set(name: FlagName, value: boolean): void {
		this.overrides = { ...this.overrides, [name]: value };
		this.persist();
	}

	/** Drops the console override so the flag follows the build again. */
	clear(name: FlagName): void {
		const rest = { ...this.overrides };
		delete rest[name];
		this.overrides = rest;
		this.persist();
	}

	clearAll(): void {
		this.overrides = {};
		this.persist();
	}

	snapshot(): Record<FlagName, { enabled: boolean; source: string; description: string }> {
		return Object.fromEntries(
			FLAG_NAMES.map((name) => [
				name,
				{
					enabled: this.enabled(name),
					source: this.sourceOf(name),
					description: FLAGS[name].description
				}
			])
		) as Record<FlagName, { enabled: boolean; source: string; description: string }>;
	}

	private persist(): void {
		if (!browser) return;
		try {
			if (Object.keys(this.overrides).length === 0) localStorage.removeItem(STORAGE_KEY);
			else localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides));
		} catch {
			// Storage unavailable: the override still applies to this page view.
		}
	}
}

export const flags = new FeatureFlags();

/**
 * Exposes the console API. Called once from the root layout.
 *
 * Deliberately available in production - being able to turn a half-finished
 * view on in a real deployment, for one browser, is the whole point.
 */
export function installFlagConsole(): void {
	if (!browser) return;

	const api = {
		enable: (name: string) => setFromConsole(name, true),
		disable: (name: string) => setFromConsole(name, false),
		reset: (name?: string) => {
			if (name === undefined) {
				flags.clearAll();
				return 'All overrides cleared.';
			}
			if (!isFlagName(name)) return unknown(name);
			flags.clear(name);
			return `${name} follows the build again.`;
		},
		list: () => {
			console.table(flags.snapshot());
			return flags.snapshot();
		}
	};

	Object.defineProperty(window, 'flags', { value: api, configurable: true });
	console.info("Feature flags available: flags.list(), flags.enable('name'), flags.reset()");
}

function setFromConsole(name: string, value: boolean): string {
	if (!isFlagName(name)) return unknown(name);
	flags.set(name, value);
	return `${name} is now ${value ? 'on' : 'off'} in this browser.`;
}

const unknown = (name: string): string =>
	`No such flag: ${name}. Known flags: ${FLAG_NAMES.join(', ')}.`;
