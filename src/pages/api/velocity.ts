/**
 * GET /api/velocity?team={id}&sprintId={n}
 *
 * Committed/completed points for one sprint, or `{ available: false }`.
 *
 * This route almost never fails: the greenhopper endpoint is undocumented and
 * unsupported, so every failure mode short of a bad token degrades to
 * `{ available: false }` with HTTP 200 and the form falls back to manual entry.
 * A 401 is the exception — it is surfaced so the UI can say "rotate the token"
 * instead of silently showing empty fields forever.
 *
 * Security: there is deliberately no auth check in this handler. Authentication
 * and authorization are enforced at the deployment layer by Cloudflare Access
 * sitting in front of the Worker, so every request that reaches this code is
 * already an authenticated team member. The route is read-only and exposes only
 * sprint point totals — never the Jira token.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { findTeam } from '../../lib/teams';
import { fetchVelocity } from '../../lib/velocity-adapter';

// Calls Jira per request: must not prerender.
export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

/** Degradation is the normal path here, so it gets a name. */
const unavailable = (): Response => json({ available: false });

export const GET: APIRoute = async ({ url }) => {
  const team = findTeam(url.searchParams.get('team'));
  if (!team || team.boardId === null) return unavailable();

  const sprintId = Number(url.searchParams.get('sprintId'));
  if (!Number.isFinite(sprintId) || sprintId <= 0) return unavailable();

  try {
    const config = readJiraConfig(env);
    return json(await fetchVelocity(config, team.boardId, sprintId));
  } catch (error) {
    // Only an invalid/expired token gets a status; everything else — including
    // "Jira isn't configured at all" — is just an unavailable velocity.
    if (error instanceof JiraError && error.kind === 'unauthorized') {
      return json({ available: false, error: error.message, kind: error.kind }, 401);
    }
    return unavailable();
  }
};
