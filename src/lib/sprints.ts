/**
 * Sprint listing for a board.
 *
 * `GET /rest/agile/1.0/board/{id}/sprint` returns sprints oldest-first, so the
 * newest closed sprints — the only ones a retro cares about — live on the last
 * page. We page by `isLast` rather than by `total`: the Agile API does not
 * guarantee `total` is present (it is absent on some board types), so anything
 * computed from it is unreliable.
 */

import { jiraFetch, type JiraConfig } from './jira';

/** The sprint fields the form actually uses. */
export interface Sprint {
  id: number;
  name: string;
  state: 'active' | 'closed' | 'future';
  goal: string;
}

interface RawSprint {
  id?: unknown;
  name?: unknown;
  state?: unknown;
  goal?: unknown;
}

interface SprintPage {
  values?: RawSprint[];
  isLast?: boolean;
  maxResults?: number;
}

/** How many closed sprints to offer in the picker, newest first. */
export const CLOSED_SPRINT_COUNT = 5;

const PAGE_SIZE = 50;
/** Guard against an unbounded loop if `isLast` never arrives. */
const MAX_PAGES = 40;

function normalize(raw: RawSprint | null | undefined): Sprint | null {
  if (!raw || typeof raw !== 'object') return null;

  // Only numbers and numeric strings count: `Number(null)`, `Number(true)` and
  // `Number([])` are all finite, which would invent sprint ids of 0 and 1.
  const id =
    typeof raw.id === 'number'
      ? raw.id
      : typeof raw.id === 'string' && raw.id.trim() !== ''
        ? Number(raw.id)
        : NaN;
  if (!Number.isFinite(id)) return null;

  const state = String(raw.state ?? '').toLowerCase();
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : `Sprint ${id}`,
    state: state === 'active' || state === 'closed' || state === 'future' ? state : 'closed',
    goal: typeof raw.goal === 'string' ? raw.goal : '',
  };
}

/** Test seam: lets the suite serve canned pages without a network. */
export interface ListSprintsOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Every active + closed sprint on a board, in API order (oldest closed first).
 * Pages until `isLast` is true, a page comes back empty, or the page cap hits.
 */
async function fetchAllSprints(
  config: JiraConfig,
  boardId: number,
  options: ListSprintsOptions,
): Promise<Sprint[]> {
  const sprints: Sprint[] = [];
  let startAt = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await jiraFetch<SprintPage>(
      config,
      `rest/agile/1.0/board/${boardId}/sprint`,
      {
        search: { state: 'active,closed', startAt, maxResults: PAGE_SIZE },
        fetchImpl: options.fetchImpl,
      },
    );

    const values = Array.isArray(body.values) ? body.values : [];
    for (const raw of values) {
      const sprint = normalize(raw);
      if (sprint) sprints.push(sprint);
    }

    // `isLast` is the documented end-of-pages signal. An empty or short page
    // also means the end — belt and braces, since `total` may not exist.
    if (body.isLast === true || values.length === 0) break;

    startAt += values.length;
  }

  return sprints;
}

export interface SprintList {
  /** The active sprint, if the board has one. */
  active: Sprint | null;
  /** Up to `CLOSED_SPRINT_COUNT` closed sprints, newest first. */
  closed: Sprint[];
  /** Picker order: active first (when present), then closed newest-first. */
  sprints: Sprint[];
  /** Sprint the form should select by default. */
  defaultSprintId: number | null;
}

/**
 * The sprints worth showing: the active one plus the most recent closed ones.
 *
 * Default selection is the active sprint when the board has one, else the most
 * recently closed — the two cases that match how retros are actually run
 * (during the sprint, or just after it closed).
 */
export async function listSprints(
  config: JiraConfig,
  boardId: number,
  options: ListSprintsOptions = {},
): Promise<SprintList> {
  const all = await fetchAllSprints(config, boardId, options);

  const active = all.find((sprint) => sprint.state === 'active') ?? null;
  // Reverse rather than sort by id: the API's own order is chronological, and
  // sprint ids are not guaranteed to increase with start date (SKIL sprint 30
  // has a higher id than sprint 31's predecessor).
  const closed = all
    .filter((sprint) => sprint.state === 'closed')
    .reverse()
    .slice(0, CLOSED_SPRINT_COUNT);

  const sprints = active ? [active, ...closed] : closed;

  return {
    active,
    closed,
    sprints,
    defaultSprintId: sprints[0]?.id ?? null,
  };
}

/**
 * Trailing sprint number from a sprint name, e.g. "REX Sprint 32" -> "32".
 * Returns `''` when the name has no trailing number ("Final push"), leaving
 * the form's sprint field for the user to fill.
 */
export function sprintNumber(name: string): string {
  const match = /(\d+)\s*$/.exec(String(name ?? '').trim());
  return match?.[1] ?? '';
}
