# UBC Prerequisite Explorer

- [ubc-prereq-visualizer.vercel.app](https://ubc-prereq-visualizer.vercel.app)
- [https://ubcvis.asarmichil.com/](https://ubcvis.asarmichil.com/)

An explorable map of course prerequisites at UBC Vancouver — 9,489 courses, 8,284 links.

- **Build a path** draws only what you pick, growing outward from a course toward what it requires or unlocks.
- **Explore** draws the whole map at once, filtered by year, faculty or subject. Behind a
  flag while it is still rough — `PUBLIC_FLAGS=explore` to ship it, or `flags.enable('explore')`
  in the browser console to see it in a deployed build.

## Data

UBC publishes no structured prerequisite data, so `scripts/` snapshots the Academic
Calendar's JSON:API and parses requirements out of the description prose into AND/OR
trees. The snapshot and the built artifacts are both committed, so a re-scrape shows
up as a reviewable diff of what changed.

```sh
bun install
bun run dev

bun run scrape      # re-snapshot the calendar (~5 min, hits UBC's API)
bun run build:data  # re-parse into static/data, and report parser coverage
```

## Analytics

`supabase/schema.sql` is the events table; `supabase/reports.sql` holds the queries
behind the Supabase Studio dashboard. Anonymous and cookieless — two random ids, eight
event names fixed by a CHECK constraint, and nothing about who anyone is. `/privacy`
lists the lot, and has to be kept in step with `src/lib/analytics.ts`.

Nothing is sent unless `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` are both
set, so dev and CI are inert by default. Set them in Vercel's production environment
only, and previews stay inert too.

SvelteKit, Sigma.js/WebGL, Tailwind. The layout is baked at build time, so the browser
never runs a layout algorithm.

Conventions, commands and gotchas: [CLAUDE.md](CLAUDE.md).
