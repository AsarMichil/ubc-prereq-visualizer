import { describe, expect, it } from 'vitest';
import { FLAGS, flags, parseEnv } from '../src/lib/flags.svelte.ts';

describe('parseEnv', () => {
	it('reads a comma-separated list', () => {
		expect(parseEnv('explore')).toEqual({ explore: true });
	});

	it('turns a flag off when the name is negated', () => {
		expect(parseEnv('-explore')).toEqual({ explore: false });
		expect(parseEnv('!explore')).toEqual({ explore: false });
	});

	it('ignores whitespace and empty entries', () => {
		expect(parseEnv('  explore , , ')).toEqual({ explore: true });
		expect(parseEnv('')).toEqual({});
	});

	it('ignores names that are not flags', () => {
		// A stale name in a Vercel environment variable must not become a flag, or
		// a typo would silently do nothing while looking like it worked.
		expect(parseEnv('explore,nonsense')).toEqual({ explore: true });
	});
});

describe('flag defaults', () => {
	it('hides explore until it is turned on', () => {
		expect(FLAGS.explore.default).toBe(false);
	});

	it('follows a console override, then goes back to the default', () => {
		expect(flags.enabled('explore')).toBe(false);

		flags.set('explore', true);
		expect(flags.enabled('explore')).toBe(true);

		flags.clear('explore');
		expect(flags.enabled('explore')).toBe(false);
	});
});
