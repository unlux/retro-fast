/// <reference types="astro/client" />

/**
 * Worker bindings and secrets — the committed source of truth for `Env`.
 *
 * `npx wrangler types` regenerates a much larger `worker-configuration.d.ts`
 * with the full workerd runtime types. That file is gitignored: it is derived
 * from the local `.dev.vars`, so it declares every variable as required and
 * differs per machine. Declaring `Env` here instead keeps the shape honest and
 * lets `tsc` pass on a clean checkout.
 *
 * Every field is optional on purpose: the app has a fully manual mode, so a
 * Worker deployed without Jira secrets must still boot and serve the form
 * rather than fail to build or throw at startup.
 *
 * Interface declarations merge, so this stays compatible when the generated
 * file is present.
 */
interface Env {
  /** Jira base URL, e.g. `https://skillion.atlassian.net` (no trailing slash). */
  JIRA_SITE?: string;
  /** Atlassian account email used as the Basic auth username. */
  JIRA_EMAIL?: string;
  /**
   * Classic (unscoped) Atlassian API token. Must be classic: scoped tokens are
   * OAuth bearer credentials and fail Basic auth on every route — 401 even on
   * `/myself`, which needs no scope. Tested 2026-08-31; see docs/PLAN.md.
   */
  JIRA_API_TOKEN?: string;
  /**
   * ISO date (YYYY-MM-DD) the token expires; drives the expiry banner.
   * Read at build time by the prerendered index page, so rotating the token
   * requires a redeploy for the banner to catch up.
   */
  JIRA_TOKEN_EXPIRY?: string;
}

/**
 * Cloudflare's runtime env module.
 *
 * `Astro.locals.runtime.env` was removed in Astro v6 / @astrojs/cloudflare v14
 * (it now throws with a message pointing here), so this is how server code
 * reads secrets. Declared locally so typechecking doesn't require the
 * generated runtime types to be present.
 */
declare module 'cloudflare:workers' {
  export const env: Env;
}
