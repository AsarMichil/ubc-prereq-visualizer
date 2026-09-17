import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// Every route prerenders (see src/routes/+layout.ts), so the app itself is
			// static files served from the CDN - including the ~7MB of course data.
			// The adapter still emits one catch-all function, which only runs for
			// URLs the filesystem doesn't match (i.e. 404s).
			adapter: adapter()
		})
	]
});
