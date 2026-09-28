<script lang="ts">
	/**
	 * What the app records, in plain terms.
	 *
	 * This page and `src/lib/analytics.ts` have to stay in step - if an event is
	 * added there, the table below says so. The event names are the same strings
	 * the database accepts, so there is nothing collected that is not listed.
	 */
	import { resolve } from '$app/paths';

	const events: { name: string; when: string; carries: string }[] = [
		{ name: 'session_start', when: 'the page opens', carries: 'referring site, rough window size' },
		{
			name: 'session_end',
			when: 'the page closes',
			carries: 'seconds spent, size of the path built'
		},
		{ name: 'search_select', when: 'you pick a course from search', carries: 'the course code' },
		{
			name: 'course_added',
			when: 'a course joins the path',
			carries: 'the course code, direction, how many'
		},
		{
			name: 'expand',
			when: 'a requirement list opens',
			carries: 'the course code, how many options'
		},
		{ name: 'course_removed', when: 'a course leaves the path', carries: 'the course code' },
		{ name: 'builder_cleared', when: 'you clear the path', carries: 'how many courses were in it' },
		{
			name: 'map_load_failed',
			when: 'the course data fails to download',
			carries: 'the error message'
		}
	];
</script>

<svelte:head>
	<title>Privacy — UBC Prerequisite Map</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed">
	<a href={resolve('/')} class="text-xs text-[var(--ink-secondary)] hover:underline"
		>← Back to the map</a
	>

	<h1 class="mt-6 text-xl font-semibold">Privacy</h1>

	<p class="mt-4 text-[var(--ink-secondary)]">
		This is a personal project, not a UBC service. It records how the path builder gets used, so
		that it can be made better. It records nothing about who you are.
	</p>

	<h2 class="mt-8 font-semibold">What is not collected</h2>
	<ul class="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-secondary)]">
		<li>No cookies.</li>
		<li>No accounts, names, emails or student numbers.</li>
		<li>No IP addresses and no browser fingerprinting.</li>
		<li>
			Not what you type into the search box — only the course code you end up picking, which is
			public information from the Academic Calendar.
		</li>
		<li>No third-party or advertising trackers. Nothing here is shared or sold.</li>
	</ul>

	<h2 class="mt-8 font-semibold">The two identifiers</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		Two random numbers are generated in your browser and attached to the events below. Neither is
		derived from anything about you or your device, and neither can be linked back to a person.
	</p>
	<ul class="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-secondary)]">
		<li>One lasts until you close the tab. It is what makes “this was all one visit” possible.</li>
		<li>
			One is kept in your browser's local storage, so a second visit can be told apart from a first.
			Clearing your site data erases it and you become a new number.
		</li>
	</ul>

	<h2 class="mt-8 font-semibold">What is recorded</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		The complete list. The database will not accept anything else.
	</p>
	<div class="mt-3 overflow-x-auto">
		<table class="w-full border-collapse text-xs">
			<thead>
				<tr class="border-b border-[var(--line)] text-left">
					<th class="py-2 pr-4 font-medium">Event</th>
					<th class="py-2 pr-4 font-medium">When</th>
					<th class="py-2 font-medium">What it carries</th>
				</tr>
			</thead>
			<tbody class="text-[var(--ink-secondary)]">
				{#each events as event (event.name)}
					<tr class="border-b border-[var(--line)]">
						<td class="py-2 pr-4 font-mono whitespace-nowrap">{event.name}</td>
						<td class="py-2 pr-4">{event.when}</td>
						<td class="py-2">{event.carries}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<h2 class="mt-8 font-semibold">Where it goes</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		Into a Postgres database hosted on Supabase, which only I can read. The table definition is in
		the repository, under <code class="font-mono text-xs">supabase/</code>.
	</p>

	<h2 class="mt-8 font-semibold">Opting out</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		Any content blocker that blocks third-party requests will stop it, and the app works exactly the
		same when it fails — every event is sent and forgotten, and nothing waits on a reply. Blocking
		requests to <code class="font-mono text-xs">supabase.co</code> is enough.
	</p>

	<p class="mt-8 text-xs text-[var(--ink-muted)]">
		Questions, or want your data removed? Open an issue on the repository.
	</p>
</div>
