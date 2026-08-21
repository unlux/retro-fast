// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

// Default output is 'static': every page prerenders unless it opts out with
// `export const prerender = false`. The adapter is present so that the M2 Jira
// API routes can opt into on-demand rendering without a config change.
export default defineConfig({
  adapter: cloudflare(),

  // Nothing here uses sessions; without this the adapter wires up a SESSION KV
  // binding that has no namespace behind it.
  session: false,

  integrations: [react()],

  vite: {
    plugins: [tailwindcss()],
  },
});