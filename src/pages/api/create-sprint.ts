/**
 * POST /api/create-sprint — body: { "team": "rex", "name": "REX Sprint 33" }
 *
 * Creates a future sprint on a team's board, for the case where the Plan tab
 * has next sprint's goals ready and the board has no future sprint to put them
 * in yet.
 *
 * The Jira contract, verified against the official Agile OpenAPI spec
 * (`https://dac-static.atlassian.com/cloud/jira/software/swagger.v3.json`, path
 * `/rest/agile/1.0/sprint`, operation "Create sprint"): "Creates a future
 * sprint. Sprint name and origin board id are required. Start date, end date,
 * and goal are optional." So the body is `{name, originBoardId}` and nothing
 * else — dates belong to whoever starts the sprint, and per the same spec note
 * a UI-started sprint ignores an `endDate` set through this call anyway.
 *
 * Guards, before Jira is called at all: the body parses; `team` is known and
 * has a board; `name` is a non-blank string of sane length. The board id comes
 * from *our* config keyed by team, never from the request — the client cannot
 * name a board to create on.
 *
 * This is a create, not an overwrite: the worst a bad request achieves is an
 * unwanted empty future sprint, which is deletable in Jira (the spec's DELETE
 * on `/rest/agile/1.0/sprint/{sprintId}` moves any open issues to the backlog;
 * a fresh future sprint has none).
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { createSprint, isValidSprintName, MAX_SPRINT_NAME } from '../../lib/sprints';
import { findTeam } from '../../lib/teams';

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

/** Shape we hope the client sent; every field is re-checked below. */
interface CreateSprintBody {
  team?: unknown;
  name?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  let body: CreateSprintBody;
  try {
    body = (await request.json()) as CreateSprintBody;
  } catch {
    return json({ error: 'Expected a JSON body.', kind: 'bad-request' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'Expected a JSON body.', kind: 'bad-request' }, 400);
  }

  const team = findTeam(typeof body.team === 'string' ? body.team : null);
  if (!team) {
    return json({ error: 'Unknown team.', kind: 'unknown-team' }, 400);
  }
  if (team.boardId === null) {
    return json(
      { error: `No Jira board is configured for ${team.name}.`, kind: 'unconfigured' },
      503,
    );
  }

  if (!isValidSprintName(body.name)) {
    // Two different mistakes, two different messages: an empty name is a
    // missing field, an over-long one is Jira's own undocumented ceiling and
    // the user needs to be told the number.
    const tooLong = typeof body.name === 'string' && body.name.trim().length > MAX_SPRINT_NAME;
    return json(
      {
        error: tooLong
          ? `Jira limits sprint names to ${MAX_SPRINT_NAME} characters.`
          : 'A sprint name is required.',
        kind: 'bad-request',
      },
      400,
    );
  }

  try {
    const config = readJiraConfig(env);
    const sprint = await createSprint(config, team.boardId, body.name);
    return json({ team: team.id, sprint, created: true });
  } catch (error) {
    if (error instanceof JiraError) {
      // 403 here is the "Manage sprints" permission, same as ending a sprint.
      return json({ error: error.message, kind: error.kind }, error.httpStatus);
    }
    return json({ error: 'Could not create the sprint in Jira.', kind: 'network' }, 502);
  }
};
