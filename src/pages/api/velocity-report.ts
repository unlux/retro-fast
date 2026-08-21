/**
 * GET /api/velocity-report?team={id}
 *
 * The whole velocity series for a team's board — `[{sprintId, name, committed,
 * completed}]`, oldest first — or `{ available: false }`.
 *
 * A separate route rather than a widened `/api/velocity` on purpose: that route
 * answers "what are this one sprint's two numbers", is called on every prefill,
 * and its response shape is what the form's velocity path parses. Adding a
 * series to it would make every prefill carry twelve sprints of payload it
 * throws away, and would put a second meaning into a response the form already
 * reads field by field. Both routes hit the same greenhopper call and the same
 * adapter; they differ only in what they project out of it.
 *
 * Degradation matches `/api/velocity` exactly: every failure but a bad token is
 * `{ available: false }` at HTTP 200, and the dialog says so plainly. 401 is
 * surfaced so the UI can say "rotate the token".
 *
 * Security: no auth check here, same as the other routes — Cloudflare Access
 * sits in front of the Worker. Read-only, and exposes only sprint names and
 * point totals, never the Jira token.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { findTeam } from '../../lib/teams';
import { fetchVelocitySeries } from '../../lib/velocity-adapter';

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

/** Degradation is a normal outcome here, so it gets a name. */
const unavailable = (): Response => json({ available: false });

export const GET: APIRoute = async ({ url }) => {
  const team = findTeam(url.searchParams.get('team'));
  if (!team || team.boardId === null) return unavailable();

  try {
    const config = readJiraConfig(env);
    return json(await fetchVelocitySeries(config, team.boardId));
  } catch (error) {
    if (error instanceof JiraError && error.kind === 'unauthorized') {
      return json({ available: false, error: error.message, kind: error.kind }, 401);
    }
    return unavailable();
  }
};
