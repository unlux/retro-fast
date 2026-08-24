/**
 * Read a Jira Space name from a board's configuration.
 *
 * Jira still calls Spaces "projects" in this REST response. A Scrum board can
 * also live under a user, so only project locations count as Space names.
 */

import { jiraFetch, type JiraConfig } from './jira';

interface BoardLocation {
  type?: unknown;
  name?: unknown;
  projectName?: unknown;
  displayName?: unknown;
}

interface BoardConfiguration {
  location?: BoardLocation;
}

function nonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Normalize the documented shape and the two older location-name variants
 * Jira Cloud has returned. The documented `name` field always wins.
 */
export function spaceNameFromBoardConfiguration(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const location = (value as BoardConfiguration).location;
  if (!location || typeof location !== 'object') return null;

  const type = nonBlankString(location.type)?.toLowerCase();
  if (type !== 'project') return null;

  return (
    nonBlankString(location.name) ??
    nonBlankString(location.projectName) ??
    nonBlankString(location.displayName)
  );
}

export interface FetchBoardSpaceNameOptions {
  fetchImpl?: typeof fetch;
}

/** Fetch the Space that contains one configured Jira board. */
export async function fetchBoardSpaceName(
  config: JiraConfig,
  boardId: number,
  options: FetchBoardSpaceNameOptions = {},
): Promise<string | null> {
  const body = await jiraFetch<unknown>(
    config,
    `rest/agile/1.0/board/${boardId}/configuration`,
    { fetchImpl: options.fetchImpl },
  );
  return spaceNameFromBoardConfiguration(body);
}
