import { defineConfig } from 'vitest/config';

/**
 * Resolved against this file rather than via `node:url`, so the config needs no
 * `@types/node` in a project that otherwise only types against the Worker
 * runtime. `import.meta.url` is a plain URL string here.
 */
const fromRoot = (path: string) => new URL(path, import.meta.url).pathname;

/**
 * Test config.
 *
 * The API routes import `env` from `cloudflare:workers`, a module that only
 * exists inside workerd. Vitest runs in Node, so the import fails outright and
 * the routes were previously untestable. Aliasing the specifier to a tiny stub
 * makes the *route handlers* — their request parsing and validation guards —
 * unit-testable without standing up a Worker. The stub deliberately provides no
 * credentials: tests that reach Jira inject their own config through the lib
 * layer instead, so no test can accidentally authenticate against a real site.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fromRoot('./src'),
      'cloudflare:workers': fromRoot('./src/test/cloudflare-workers-stub.ts'),
    },
  },
});
