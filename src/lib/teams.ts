/**
 * Team config accessors.
 *
 * `config/teams.json` is checked in and contains no secrets. It is imported
 * (not fetched) so the bundle carries it and the API routes need no filesystem.
 *
 * `recipients` is intentionally client-visible: the mail button builds the
 * `mailto:` link in the browser, and the deployment sits behind Cloudflare
 * Access, so only authenticated team members ever load the page.
 */

import teamsConfig from '../../config/teams.json';

export interface TeamConfig {
  id: string;
  /** Offline fallback. The live Space name comes from Jira board configuration. */
  fallbackName: string;
  titleTemplate: string;
  boardId: number | null;
  recipients: string[];
}

export const teams = ((teamsConfig as { teams?: TeamConfig[] }).teams ?? []) as TeamConfig[];

/** Look up a team by id from a query parameter. Returns `undefined` if unknown. */
export function findTeam(id: string | null): TeamConfig | undefined {
  if (!id) return undefined;
  return teams.find((team) => team.id === id);
}
