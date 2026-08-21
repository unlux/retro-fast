/**
 * Stand-in for the `cloudflare:workers` runtime module, used only by Vitest
 * (wired up in vitest.config.ts). It exists so the API route handlers can be
 * imported and their validation guards unit-tested in plain Node.
 *
 * `env` is intentionally empty. Any test that gets past the request-validation
 * guards and calls `readJiraConfig` will therefore get a clean `unconfigured`
 * JiraError rather than reaching out to a real Jira site — which is exactly the
 * behaviour we want from a test suite that must never touch live sprints.
 */
export const env = {} as unknown as Env;
