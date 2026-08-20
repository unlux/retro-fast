/**
 * Team config accessors.
 *
 * `config/teams.json` is checked in and contains no secrets. It is imported
 * (not fetched) so the bundle carries it and the API routes need no filesystem.
 */

import teamsConfig from '../../config/teams.json';

export interface TeamConfig {
  id: string;
  name: string;
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
