/**
 * GET /api/sprints?team={id}
 *
 * The board's active sprint plus its most recently closed ones, each with the
 * goal text already attached (the Agile API includes `goal` on the sprint
 * object, so no per-sprint fetch is needed).
 *
 * Security: there is deliberately no auth check in this handler. Authentication
 * and authorization are enforced at the deployment layer by Cloudflare Access
 * sitting in front of the Worker, so every request that reaches this code is
 * already an authenticated team member. The route is read-only and exposes only
 * sprint metadata (names, dates, goal text) — never the Jira token.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { listSprints } from '../../lib/sprints';
import { findTeam } from '../../lib/teams';

// Calls Jira per request: must not prerender.
export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Sprint goals change mid-sprint; never let a proxy hold them.
      'cache-control': 'no-store',
    },
  });

export const GET: APIRoute = async ({ url }) => {
  const team = findTeam(url.searchParams.get('team'));
  if (!team) {
    return json({ error: 'Unknown team.', kind: 'unknown-team' }, 400);
  }
  if (team.boardId === null) {
    return json(
      { error: `No Jira board is configured for ${team.name}.`, kind: 'unconfigured' },
      503,
    );
  }

  try {
    const config = readJiraConfig(env);
    const { sprints, defaultSprintId } = await listSprints(config, team.boardId);
    return json({ team: team.id, sprints, defaultSprintId });
  } catch (error) {
    if (error instanceof JiraError) {
      return json({ error: error.message, kind: error.kind }, error.httpStatus);
    }
    return json({ error: 'Could not load sprints from Jira.', kind: 'network' }, 502);
  }
};
