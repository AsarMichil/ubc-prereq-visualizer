<script lang="ts">
	/**
	 * What the app records, in plain terms.
	 *
	 * Deliberately short: what is *not* collected is the part a student actually
	 * needs, and `supabase/schema.sql` is the exhaustive list for anyone who
	 * wants one.
	 */
	import { resolve } from '$app/paths';
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
		Two random numbers are generated in your browser and attached to what is recorded. Neither is
		derived from anything about you or your device, and neither can be linked back to a person.
	</p>
	<ul class="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-secondary)]">
		<li>One lasts until you close the tab. It is what makes “this was all one visit” possible.</li>
		<li>
			One is kept in your browser's local storage, so a second visit can be told apart from a first.
			Clearing your site data erases it and you become a new number.
		</li>
	</ul>

	<!--
		Who is behind it. A privacy page that says "nothing about who you are" should
		be willing to say who is on the other end of that.
	-->
	<p class="mt-10 border-t border-[var(--line)] pt-6 text-xs text-[var(--ink-muted)]">
		Built by Asar Zuluev —
		<a href="https://asarmichil.com" class="hover:underline">asarmichil.com</a>
	</p>
</div>
