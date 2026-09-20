/**
 * Typed context for the two long-lived state objects.
 *
 * Both were previously threaded through every component as props. Context scopes
 * them to the page that owns them without the prop drilling, and - unlike a
 * module-level singleton - keeps them per-instance, so nothing could leak
 * between users if this ever renders on the server.
 *
 * `createContext` is used rather than `setContext`/`getContext` because it
 * carries the type through instead of relying on a stringly-typed key.
 */
import { createContext } from 'svelte';
import type { ExplorerState } from './explorer.svelte';
import type { PathBuilderState } from './pathBuilder.svelte';

export const [getExplorer, setExplorer] = createContext<ExplorerState>();
export const [getBuilder, setBuilder] = createContext<PathBuilderState>();
