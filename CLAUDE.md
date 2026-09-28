# ubc-prereq-visualizer

## Commits

Semantic, with a scope prefix:

```
[Scope] type: short description
```

`type` is one of `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`.
`Scope` names the area touched — `UI`, `Parser`, `Data`, `Build`, `Docs`.

```
[UI] feat: draw shared prerequisites as a single node
[Parser] fix: handle quantifiers written without "of"
[Data] chore: refresh the calendar snapshot
```

## Pull requests

Keep them short. Three sections, nothing else:

- **What** — the change, in a sentence or two.
- **How** — the approach, only where the diff doesn't already show it.
- **Notes** — what a reviewer needs: risks, follow-ups, anything deliberately left out.

Don't restate the diff and don't pad.

## Branching

Never push to `main`. Branch, push, open a PR; it gets squash-merged on GitHub.

Changes under `.github/` need a review from @AsarMichil specifically (see `.github/CODEOWNERS`).

## Feature flags

Defined in `src/lib/flags.svelte.ts`. Set for a build with `PUBLIC_FLAGS=name` (a
Vercel environment variable; prefix `-name` to force off), or per-browser from the
console with `flags.enable('name')`. The console wins. `explore` is currently off.

## Commands

```
bun run dev          dev server
bun run test         vitest
bun run check        svelte-check
bun run lint         prettier + eslint
bun run scrape       re-snapshot the UBC calendar (~5 min, hits their API)
bun run build:data   re-parse and rebuild static/data (~1 min: runs the force layout)
```

## Gotchas

- `static/data/` and `data/raw/` are **committed**. After changing anything under
  `scripts/lib/`, run `bun run build:data` so the shipped data matches the parser.
- `build:data` fails if the parser drops a course code that the source text mentions.
  It cannot catch a code parsed under the _wrong operator_ — check `data/coverage.md`
  and the diff of `static/data/` when touching the grammar.
- There is no `svelte.config.js`; SvelteKit options live inline in `vite.config.ts`.
- **Nothing applies `supabase/schema.sql`.** There is no migration pipeline and the
  GitHub integration is deliberately not connected, so pushing a change to that file
  changes nothing in the database — run the SQL by hand in the Supabase SQL editor.
  It is a create-from-scratch script describing the current state, not a migration:
  re-running it on a live database fails on the first `create table`. To change the
  schema, write the specific `alter`, run that, then edit `schema.sql` to match.
- Adding an analytics event means four places, and missing one fails in a different
  way each time: the `name` CHECK constraint in `supabase/schema.sql` (the insert is
  rejected), `EventName` in `src/lib/analytics.ts` (it won't typecheck), the table in
  `src/routes/privacy/+page.svelte` (the page silently understates what is collected),
  and usually `supabase/reports.sql`.
