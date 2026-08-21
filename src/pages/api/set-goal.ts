/**
 * POST /api/set-goal — body: { "team": "rex", "sprintId": 123, "goal": "…" }
 *
 * Writes next sprint's goal text into Jira. The Plan tab's push action.
 *
 * What is validated, in order, before Jira's write endpoint is touched:
 *
 *  1. The body parses as JSON and carries a usable `team`, `sprintId` and
 *     `goal`.
 *  2. `team` is one we know, and has a board configured.
 *  3. `sprintId` appears in *that board's own* sprint listing — proving the
 *     sprint exists and belongs to this team, not another's board.
 *  4. That listing reports the sprint as `future`.
 *
 * Steps 3 and 4 happen server-side in `setSprintGoal`, read from Jira rather
 * than taken from the request. The `future`-only rule is stricter than Jira's
 * own (Jira permits editing an active or closed sprint's goal): this route
 * plans the *next* sprint, so overwriting the goal of the sprint the team is
 * currently working — or of one already written up in a retro — is refused with
 * a 400 and never reaches Jira.
 *
 * Security: as with every other route, authentication is Cloudflare Access in
 * front of the Worker. What this route adds is that it *changes* Jira, so the
 * guards above are about blast radius: the worst a malformed or malicious body
 * can do is have its own request refused.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { setSprintGoal } from '../../lib/sprints';
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

/**
 * A sprint goal is one plain-text field. The ceiling is a sanity bound, not a
 * documented Jira limit — the OpenAPI schema types `goal` as a plain string
 * with no `maxLength` — and it is far above any real retro's goal list.
 */
const MAX_GOAL_LENGTH = 32_000;

/** Shape we hope the client sent; every field is re-checked below. */
interface SetGoalBody {
  team?: unknown;
  sprintId?: unknown;
  goal?: unknown;
}

export const POST: APIRoute = async ({ request }) => {
  let body: SetGoalBody;
  try {
    body = (await request.json()) as SetGoalBody;
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

  // The goal must be a string, and must not be blank: clearing a sprint's goal
  // is not something this tool offers, so an empty push is a mistake rather
  // than an instruction.
  if (typeof body.goal !== 'string' || body.goal.trim() === '') {
    return json({ error: 'A non-empty goal is required.', kind: 'bad-request' }, 400);
  }
  if (body.goal.length > MAX_GOAL_LENGTH) {
    return json({ error: 'That goal text is too long.', kind: 'bad-request' }, 400);
  }

  try {
    const config = readJiraConfig(env);
    const result = await setSprintGoal(config, team.boardId, sprintId, body.goal);

    // The guard refused: the sprint isn't on this board, or isn't a future one.
    // Jira's write endpoint was never called.
    if (!result.ok) {
      return json({ error: result.message, kind: result.reason, state: result.state }, 400);
    }

    return json({ team: team.id, sprint: result.sprint, updated: true });
  } catch (error) {
    if (error instanceof JiraError) {
      // 401 and 403 both mean "the token can't do this", but the fixes differ:
      // rotate the token vs. grant the "Manage sprints" permission.
      return json({ error: error.message, kind: error.kind }, error.httpStatus);
    }
    return json({ error: 'Could not set the sprint goal in Jira.', kind: 'network' }, 502);
  }
};
