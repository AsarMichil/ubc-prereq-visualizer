# UBC Prerequisite Explorer

- [ubc-prereq-visualizer.vercel.app](https://ubc-prereq-visualizer.vercel.app)
- [https://ubcvis.asarmichil.com/](https://ubcvis.asarmichil.com/)

An explorable map of course prerequisites at UBC Vancouver — 9,489 courses, 8,284 links.

- **Explore** draws the whole map at once, filtered by year, faculty or subject.
- **Build a path** draws only what you pick, growing outward from a course toward what it requires or unlocks.

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

SvelteKit, Sigma.js/WebGL, Tailwind. The layout is baked at build time, so the browser
never runs a layout algorithm.

Conventions, commands and gotchas: [CLAUDE.md](CLAUDE.md).
