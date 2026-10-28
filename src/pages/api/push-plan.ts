import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { pushPlan } from '../../lib/push-plan';
import { findTeam } from '../../lib/teams';

export const prerender = false;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

/** Cloudflare Access authenticates this route, as with the other Jira routes. */
export const POST: APIRoute = async ({ request }) => {
  let body;
  try { body = await request.json(); } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }
  if (!body || typeof body !== 'object') return json({ error: 'Expected a JSON body.' }, 400);
  const team = findTeam(typeof body.team === 'string' ? body.team : null);
  if (!team) return json({ error: 'Unknown space.' }, 400);
  if (team.boardId === null) return json({ error: 'No Jira board is configured.' }, 503);
  if (typeof body.goal !== 'string' || !body.goal.trim() || body.goal.length > 32000) {
    return json({ error: 'Provide a plan between 1 and 32000 characters.' }, 400);
  }
  if ((body.expectedSprintId !== null && (!Number.isInteger(body.expectedSprintId) || body.expectedSprintId <= 0)) ||
      typeof body.expectedGoal !== 'string' || body.expectedGoal.length > 32000) {
    return json({ error: 'Reload the target sprint before pushing.' }, 400);
  }
  try {
    const result = await pushPlan(readJiraConfig(env), team.boardId, body);
    return result.ok ? json(result) : json({ error: result.message, sprint: result.sprint }, 409);
  } catch (error) {
    if (error instanceof JiraError) return json({ error: error.message }, error.httpStatus);
    return json({ error: 'Could not confirm the push. Retry to check Jira before writing again.' }, 502);
  }
};
