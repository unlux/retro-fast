/**
 * POST /api/end-sprint  — body: { "team": "rex", "sprintId": 123 }
 *
 * Closes an active sprint in Jira. This is the only write the app performs, and
 * it is irreversible from here: closing a sprint moves its incomplete issues to
 * the backlog for the whole team, so the route treats every request as suspect
 * until proven otherwise.
 *
 * What is validated, in order, before Jira's write endpoint is touched at all:
 *
 *  1. The body parses as JSON and carries a usable `team` and `sprintId`.
 *  2. `team` is one we know, and has a board configured.
 *  3. `sprintId` appears in *that board's own* sprint listing — proving the
 *     sprint exists and belongs to this team, not another's board.
 *  4. That listing reports the sprint as `active`.
 *
 * Steps 3 and 4 happen server-side in `closeSprint`, from Jira's data rather
 * than the client's claim, and both refuse with a 400 without issuing the POST.
 * A sprint that closed in another tab a moment ago therefore fails the guard
 * instead of being closed twice.
 *
 * Security: as with the read routes, there is no auth check in this handler —
 * Cloudflare Access sits in front of the Worker, so every request that arrives
 * is already an authenticated team member. What this route adds over the read
 * routes is that it can *change* Jira, so the validation above is about
 * correctness and blast radius, not authentication.
 *
 * Permissions: closing a sprint requires the acting Jira user (JIRA_EMAIL) to
 * hold the "Manage sprints" project permission. Without it Jira answers 403 and
 * that is surfaced verbatim rather than being swallowed.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { closeSprint } from '../../lib/sprints';
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
interface EndSprintBody {
  team?: unknown;
  sprintId?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  let body: EndSprintBody;
  try {
    body = (await request.json()) as EndSprintBody;
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
      { error: `No Jira board is configured for ${team.fallbackName}.`, kind: 'unconfigured' },
      503,
    );
  }

  // Only a positive integer can be a sprint id. `Number(null)` and `Number([])`
  // are both 0, so the type is checked before the coercion.
  const rawId = body.sprintId;
  const sprintId =
    typeof rawId === 'number'
      ? rawId
      : typeof rawId === 'string' && rawId.trim() !== ''
        ? Number(rawId)
        : NaN;
  if (!Number.isInteger(sprintId) || sprintId <= 0) {
    return json({ error: 'A valid sprintId is required.', kind: 'bad-request' }, 400);
  }

  try {
    const config = readJiraConfig(env);
    const result = await closeSprint(config, team.boardId, sprintId);

    // The guard refused: the sprint isn't on this board, or isn't active.
    // Jira's write endpoint was never called.
    if (!result.ok) {
      return json({ error: result.message, kind: result.reason, state: result.state }, 400);
    }

    return json({ team: team.id, sprint: result.sprint, closed: true });
  } catch (error) {
    if (error instanceof JiraError) {
      // 401 and 403 both mean "the token can't do this", but for different
      // reasons, and the fixes differ (rotate vs. grant "Manage sprints").
      return json({ error: error.message, kind: error.kind }, error.httpStatus);
    }
    return json({ error: 'Could not end the sprint in Jira.', kind: 'network' }, 502);
  }
};
