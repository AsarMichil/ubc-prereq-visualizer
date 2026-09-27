<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { installFlagConsole } from '$lib/flags.svelte';

	let { children } = $props();

	// Once, at the root: exposes `flags` on window so a deployed build can be
	// switched around from the console without a redeploy.
	installFlagConsole();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
