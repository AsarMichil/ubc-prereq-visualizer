<script lang="ts">
	/**
	 * Accuracy first, then privacy.
	 *
	 * Accuracy leads because it is the one that can actually cost a student
	 * something: the prerequisites here are parsed out of prose and can be wrong,
	 * and the empty state links here saying so. The privacy half is deliberately
	 * short - what is *not* collected is the part worth reading, and
	 * `supabase/schema.sql` is the exhaustive list for anyone who wants one.
	 */
	import { resolve } from '$app/paths';

	const ISSUES = 'https://github.com/AsarMichil/ubc-prereq-visualizer/issues';
</script>

<svelte:head>
	<title>About — UBC Prerequisite Map</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-12 text-sm leading-relaxed">
	<a href={resolve('/')} class="text-xs text-[var(--ink-secondary)] hover:underline"
		>← Back to the map</a
	>

	<h1 class="mt-6 text-xl font-semibold">About</h1>

	<p class="mt-4 text-[var(--ink-secondary)]">
		A map of course prerequisites at UBC Vancouver. It is a personal project and is
		<strong class="font-semibold text-[var(--ink-primary)]">not affiliated with UBC</strong>.
	</p>

	<h2 class="mt-8 font-semibold">It is not guaranteed to be accurate</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		UBC does not publish prerequisites in any structured form, so they are read out of the written
		descriptions in the Academic Calendar. That parsing gets a lot right and it definitely gets some
		things wrong — a requirement can be missed, misread, or go stale after UBC changes it.
	</p>
	<p class="mt-2 text-[var(--ink-secondary)]">
		So treat this as a tool for seeing how courses connect and for planning around them — not as the
		final word. Before you register, check the course in the
		<a
			href="https://vancouver.calendar.ubc.ca/course-descriptions"
			class="underline underline-offset-2">Academic Calendar</a
		>, and talk to an advisor if anything matters. I try to keep it current, but I can only promise
		best effort.
	</p>

	<h2 class="mt-8 font-semibold">Found something wrong?</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		Please tell me — it is the fastest way this gets better. Email
		<a href="mailto:ubcvis@asarmichil.com" class="underline underline-offset-2"
			>ubcvis@asarmichil.com</a
		>
		or
		<a href={ISSUES} class="underline underline-offset-2">open an issue on GitHub</a>.
	</p>

	<h2 class="mt-8 font-semibold">Privacy</h2>
	<p class="mt-2 text-[var(--ink-secondary)]">
		It records how the path builder gets used, so that it can be made better, and nothing about who
		you are. Specifically:
	</p>
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
