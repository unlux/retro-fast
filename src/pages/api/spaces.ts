/**
 * GET /api/spaces
 *
 * Returns the Jira Space name for every configured board. Team ids stay local
 * and stable; only the human-facing names come from Jira.
 */

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { JiraError, readJiraConfig } from '../../lib/jira';
import { fetchBoardSpaceName } from '../../lib/spaces';
import { teams } from '../../lib/teams';

export const prerender = false;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export const GET: APIRoute = async () => {
  try {
    const config = readJiraConfig(env);
    const spaces = await Promise.all(
      teams.map(async (team) => {
        if (team.boardId === null) return null;
        try {
          const name = await fetchBoardSpaceName(config, team.boardId);
          return name === null ? null : { id: team.id, name };
        } catch {
          // One inaccessible board must not hide names from the other spaces.
          return null;
        }
      }),
    );

    return json({ spaces: spaces.filter((space) => space !== null) });
  } catch (error) {
    if (error instanceof JiraError) {
      return json({ error: error.message, kind: error.kind }, error.httpStatus);
    }
    return json({ error: 'Could not load Space names from Jira.', kind: 'network' }, 502);
  }
};
