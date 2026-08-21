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
  /**
   * ISO timestamps as Jira sends them, or null when absent. Dates make the
   * picker legible — "REX Sprint 31" alone doesn't say which fortnight it was.
   */
  startDate: string | null;
  endDate: string | null;
  /** Only closed sprints have one, and it can differ from `endDate`. */
  completeDate: string | null;
}

interface RawSprint {
  id?: unknown;
  name?: unknown;
  state?: unknown;
  goal?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  completeDate?: unknown;
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
    startDate: isoDate(raw.startDate),
    endDate: isoDate(raw.endDate),
    completeDate: isoDate(raw.completeDate),
  };
}

/**
 * A Jira date field, kept only when it is a string that actually parses.
 * A malformed date would render as "Invalid Date" in the picker, which is
 * worse than no date at all.
 */
function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

/**
 * Sprint label for the picker, e.g. "REX Sprint 31 (1 Jul – 14 Jul)".
 *
 * The locale is pinned to en-GB rather than the viewer's, so the order is
 * always day-then-month. This is an Australian team reading a fortnight at a
 * glance; a browser defaulting to en-US would silently render "Jul 1 – Jul 14"
 * for one reader and "1 Jul – 14 Jul" for the next. The year is added only when
 * the sprint didn't run in the current year — otherwise it is noise on every
 * single option.
 */
export function sprintDateRange(sprint: Sprint, now: Date = new Date()): string {
  const start = sprint.startDate === null ? null : new Date(sprint.startDate);
  const end =
    sprint.completeDate ?? sprint.endDate
      ? new Date((sprint.completeDate ?? sprint.endDate)!)
      : null;

  const format = (date: Date): string => {
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  };

  if (start && end) return `${format(start)} – ${format(end)}`;
  if (start) return format(start);
  if (end) return format(end);
  return '';
}

/** Full picker label: name, "(active)" when it is, and the date range. */
export function sprintLabel(sprint: Sprint, now: Date = new Date()): string {
  const range = sprintDateRange(sprint, now);
  const name = sprint.state === 'active' ? `${sprint.name} (active)` : sprint.name;
  return range === '' ? name : `${name} (${range})`;
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
  /**
   * Which states to ask Jira for. Defaults to the three the app knows about,
   * because the Plan tab needs `future` sprints to push next sprint's goal
   * into, and one listing call answering everything is cheaper than two.
   *
   * The guards never rely on this filter: `closeSprint` re-checks the state it
   * reads back, so a widened query cannot widen what is closeable.
   */
  states = 'active,closed,future',
): Promise<Sprint[]> {
  const sprints: Sprint[] = [];
  let startAt = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await jiraFetch<SprintPage>(
      config,
      `rest/agile/1.0/board/${boardId}/sprint`,
      {
        search: { state: states, startAt, maxResults: PAGE_SIZE },
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
  /**
   * Not-yet-started sprints, in board order (the order Jira lists them, which
   * is the order they will run). The Plan tab pushes next sprint's goal into
   * the first of these.
   *
   * Deliberately a *separate* array rather than folded into `sprints`: the
   * retro picker offers "which retro am I writing", and a sprint that has not
   * happened has no retro. Adding them to `sprints` would have put an
   * unwritable option in the middle of the existing picker.
   */
  future: Sprint[];
  /** Picker order: active first (when present), then closed newest-first. */
  sprints: Sprint[];
  /** Sprint the form should select by default. */
  defaultSprintId: number | null;
  /**
   * The most recent sprint name on the board, whatever its state — the basis
   * for suggesting the next sprint's name when one has to be created.
   */
  latestName: string | null;
}

/**
 * The sprints worth showing: the active one plus the most recent closed ones,
 * and separately the future ones the Plan tab can push into.
 *
 * Default selection is the active sprint when the board has one, else the most
 * recently closed — the two cases that match how retros are actually run
 * (during the sprint, or just after it closed). Future sprints are never the
 * default: there is no retro to write for a sprint that has not run.
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

  const future = all.filter((sprint) => sprint.state === 'future');

  const sprints = active ? [active, ...closed] : closed;

  // Name to increment when suggesting a new sprint. The last future sprint is
  // the furthest ahead the board goes; failing that the active one, then the
  // newest closed — always the highest-numbered name that exists.
  const latest = future[future.length - 1] ?? active ?? closed[0] ?? null;

  return {
    active,
    closed,
    future,
    sprints,
    defaultSprintId: sprints[0]?.id ?? null,
    latestName: latest?.name ?? null,
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

/**
 * The name to suggest for the next sprint: the latest name with its trailing
 * number incremented. "REX Sprint 32" -> "REX Sprint 33".
 *
 * Only the trailing run of digits moves, so the board's own prefix and spacing
 * survive verbatim — the boards use "REX Sprint 32", "SKIL Sprint 30" and
 * "Marketing Sprint 31", and a suggestion that renamed the series would be
 * worse than no suggestion. A name with no trailing number (or no name at all)
 * gets `''`, and the UI asks the user to type one rather than inventing a
 * series that does not exist.
 *
 * Leading zeros are preserved by width ("Sprint 09" -> "Sprint 10"), because a
 * board that pads its numbers is a board that sorts on them.
 */
export function nextSprintName(latestName: string | null | undefined): string {
  const name = String(latestName ?? '').trim();
  const match = /^(.*?)(\d+)(\s*)$/.exec(name);
  if (!match) return '';
  const [, prefix, digits, trailing] = match;
  const next = String(Number(digits) + 1);
  // Keep the field width when the original was zero-padded.
  const padded = digits!.length > next.length ? next.padStart(digits!.length, '0') : next;
  return `${prefix}${padded}${trailing}`;
}

// -------------------------------------------------------------- creating

/** Jira trims sprint names; an all-whitespace one is not a name. */
const MAX_SPRINT_NAME = 255;

/**
 * Whether a proposed sprint name is one we are willing to send.
 *
 * Jira itself only requires a non-empty name, but "the client said so" is not a
 * reason to create a sprint called `\n\n`. The ceiling is a sanity bound rather
 * than a documented limit — the OpenAPI schema types `name` as a plain string
 * with no `maxLength`.
 */
export function isValidSprintName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SPRINT_NAME;
}

/**
 * Create a future sprint on a board.
 *
 * The Jira contract, verified against the official Agile OpenAPI spec
 * (`https://dac-static.atlassian.com/cloud/jira/software/swagger.v3.json`,
 * path `/rest/agile/1.0/sprint`, operation "Create sprint"): "Creates a future
 * sprint. Sprint name and origin board id are required. Start date, end date,
 * and goal are optional." So `{name, originBoardId}` is the whole body — dates
 * are left to Jira and to whoever starts the sprint, since the spec also notes
 * that a UI-started sprint ignores the `endDate` set through this call and uses
 * the previous sprint's duration instead.
 *
 * A created sprint always comes back in the `future` state, which is exactly
 * what `setSprintGoal` will then accept.
 */
export async function createSprint(
  config: JiraConfig,
  boardId: number,
  name: string,
  options: ListSprintsOptions = {},
): Promise<Sprint> {
  const created = await jiraFetch<RawSprint>(config, 'rest/agile/1.0/sprint', {
    method: 'POST',
    body: { name: name.trim(), originBoardId: boardId },
    fetchImpl: options.fetchImpl,
  });

  // Jira echoes the created sprint. If the echo is unreadable the sprint still
  // exists, so report it rather than failing — the caller refetches the list.
  return (
    normalize(created) ?? {
      id: NaN,
      name: name.trim(),
      state: 'future',
      goal: '',
      startDate: null,
      endDate: null,
      completeDate: null,
    }
  );
}

// ------------------------------------------------------------ setting a goal

/** Why a goal write was refused before Jira's write endpoint was touched. */
export type SetGoalRefusal =
  /** The sprint id isn't on this team's board (or doesn't exist). */
  | 'not-on-board'
  /** The sprint is on the board but has already started, or has finished. */
  | 'not-future';

export interface SetGoalRefused {
  ok: false;
  reason: SetGoalRefusal;
  message: string;
  state?: Sprint['state'];
}

export interface SetGoalDone {
  ok: true;
  sprint: Sprint;
}

export type SetGoalResult = SetGoalDone | SetGoalRefused;

/**
 * Write a sprint's goal, for a future sprint on the caller's own board.
 *
 * Guarded exactly like `closeSprint`, and for the same reason: this is a write,
 * so nothing the client claims is believed. The sprint is re-read from *this
 * team's board listing* server-side, and the write only happens if that listing
 * says the sprint is real, belongs to the board, and is still `future`.
 *
 * The `future`-only rule is the interesting one, and it is deliberately
 * stricter than Jira's. Jira will happily let you rewrite an active or even a
 * closed sprint's goal (the spec: "For closed sprints, only the name and goal
 * can be updated"). But this tool's Plan tab exists to set *next* sprint's
 * goals — overwriting the goal of the sprint the team is currently working, or
 * of one already written up in a retro, is never the intent and is not
 * recoverable from here. So the app refuses it before Jira gets a say.
 *
 * The body is `{goal}` alone: POST is a partial update — "fields not present in
 * the request JSON will not be updated" — so the name, dates and state are all
 * left exactly as they were. PUT would null every omitted field, which is
 * precisely why this is not a PUT.
 */
export async function setSprintGoal(
  config: JiraConfig,
  boardId: number,
  sprintId: number,
  goal: string,
  options: ListSprintsOptions = {},
): Promise<SetGoalResult> {
  const onBoard = (await fetchAllSprints(config, boardId, options)).find(
    (sprint) => sprint.id === sprintId,
  );

  if (!onBoard) {
    return {
      ok: false,
      reason: 'not-on-board',
      message: 'That sprint is not on this team’s board.',
    };
  }

  if (onBoard.state !== 'future') {
    return {
      ok: false,
      reason: 'not-future',
      state: onBoard.state,
      message:
        onBoard.state === 'active'
          ? `${onBoard.name} is already running, so its goal is not set from here.`
          : `${onBoard.name} is closed, so its goal can no longer be planned.`,
    };
  }

  const updated = await jiraFetch<RawSprint>(config, `rest/agile/1.0/sprint/${sprintId}`, {
    method: 'POST',
    body: { goal },
    fetchImpl: options.fetchImpl,
  });

  return {
    ok: true,
    sprint: normalize(updated) ?? { ...onBoard, goal },
  };
}

// --------------------------------------------------------------- closing

/**
 * Why a close request was refused before Jira was ever asked.
 *
 * Every one of these is a client-side claim we declined to believe. The route
 * maps them to 400s; none of them reach Jira's write endpoint.
 */
export type CloseRefusal =
  /** The sprint id isn't on this team's board (or doesn't exist). */
  | 'not-on-board'
  /** The sprint exists on the board but isn't active — already closed, or future. */
  | 'not-active';

export interface CloseSprintRefused {
  ok: false;
  reason: CloseRefusal;
  message: string;
  /** The sprint's real state as Jira reports it, when we got that far. */
  state?: Sprint['state'];
}

export interface CloseSprintDone {
  ok: true;
  sprint: Sprint;
}

export type CloseSprintResult = CloseSprintDone | CloseSprintRefused;

/**
 * Close an active sprint on a board.
 *
 * This is the app's only Jira write, so it is deliberately paranoid. The client
 * sends a team and a sprint id and nothing else is trusted: the sprint is
 * re-fetched from *this team's board listing* server-side, and the write only
 * happens if that listing says the sprint is real, belongs to the board, and is
 * currently `active`. A client asking to close someone else's sprint, or a
 * sprint that closed thirty seconds ago in another tab, is refused here — before
 * any POST is issued.
 *
 * The Jira contract (verified against the official Agile OpenAPI spec, path
 * `/rest/agile/1.0/sprint/{sprintId}`, operation "Partially update sprint"):
 * POST is a *partial* update — "fields not present in the request JSON will not
 * be updated" — so `{state: 'closed'}` alone is the whole body. No startDate or
 * endDate passthrough is required; that would only be needed for PUT, the full
 * update, which nulls every field the body omits. The spec further states "a
 * sprint can be completed by updating the state to 'closed'. This action
 * requires the sprint to be in the 'active' state. This sets the completeDate
 * to the time of the request."
 */
export async function closeSprint(
  config: JiraConfig,
  boardId: number,
  sprintId: number,
  options: ListSprintsOptions = {},
): Promise<CloseSprintResult> {
  // Never trust the client's word on which sprint this is. Read the board's own
  // sprint list and find the id there — this proves board membership and gives
  // us the authoritative state in one call.
  const onBoard = (await fetchAllSprints(config, boardId, options)).find(
    (sprint) => sprint.id === sprintId,
  );

  if (!onBoard) {
    return {
      ok: false,
      reason: 'not-on-board',
      message: 'That sprint is not on this team’s board.',
    };
  }

  if (onBoard.state !== 'active') {
    return {
      ok: false,
      reason: 'not-active',
      state: onBoard.state,
      message:
        onBoard.state === 'closed'
          ? `${onBoard.name} is already closed.`
          : `${onBoard.name} has not started yet, so it cannot be closed.`,
    };
  }

  // Guard passed: this is a real, active sprint on the caller's own board.
  const updated = await jiraFetch<RawSprint>(config, `rest/agile/1.0/sprint/${sprintId}`, {
    method: 'POST',
    body: { state: 'closed' },
    fetchImpl: options.fetchImpl,
  });

  // Jira echoes the updated sprint. Fall back to a locally-closed copy if the
  // response is unparseable — the write already succeeded either way.
  return {
    ok: true,
    sprint: normalize(updated) ?? { ...onBoard, state: 'closed' },
  };
}
