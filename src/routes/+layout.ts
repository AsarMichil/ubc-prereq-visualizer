/**
 * The app is a single client-rendered explorer over a static data payload, so
 * everything prerenders to files and Vercel ships no serverless functions.
 */
export const prerender = true;
export const ssr = false;
