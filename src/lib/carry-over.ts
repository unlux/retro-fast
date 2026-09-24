/**
 * End a sprint and carry its unfinished issues into the next one.
 *
 * Jira has no single call for this. The close endpoint's
 * `incompleteIssuesDestinationId` field is undocumented and broken
 * (JSWSERVER-26129): the sprint closes and the open issues land in the backlog
 * regardless. So the app composes the flow the way Atlassian's own knowledge
 * base workaround does, with one difference of order:
 *
 *  1. Read the sprint's unfinished issues. "Unfinished" means not in the
 *     board's Done column, read from the board configuration rather than the
 *     status by name. The list must be read *before* the close, because closing
 *     is what moves the issues to the backlog.
 *  2. Close the sprint, through the same guard the app has always used. Nothing
 *     the client claims is believed.
 *  3. Send the issues to the board's next future sprint, creating one when the
 *     board has none. The target is chosen from Jira's own board order, which is
 *     the order the Complete Sprint dialog lists, from a listing read *after*
 *     the close so a sprint created or started in the meantime is respected.
 *
 * Step 2 runs before step 3 on purpose. If the issues were moved while the
 * sprint was still active, Jira's Sprint Report would file them under "Issues
 * removed from sprint". Moving them after the close keeps them under "Issues
 * not completed", which is what the retro is about.
 *
 * Pulling the issues out of a closed sprint is not possible: they are already
 * gone from it. Instead they are moved from the backlog, which is where closing
 * puts them, into the successor. That move records a Sprint field change on each
 * issue's history, exactly as a manual move would.
 *
 * No ranking is applied. Jira's rank is global to the board, so ranking carried
 * work would also reorder it in the backlog and on any board sharing the rank
 * field. Without a rank instruction the issues keep their global order, the same
 * behaviour Jira's own Complete Sprint dialog has.
 */

import { JiraError, jiraFetch, type JiraConfig } from './jira';
import {
  createSprint,
  listSprints,
  nextSprintName,
  readCloseTarget,
  type CloseRefusal,
  type ListSprintsOptions,
  type Sprint,
} from './sprints';

/** Jira's cap on one move-issues-to-sprint-and-rank call. */
export const MAX_MOVE_PER_CALL = 50;

/** Guard against an unbounded issue listing if the end signal never arrives. */
const MAX_ISSUE_PAGES = 40;
const ISSUE_PAGE_SIZE = 50;

/**
 * Status ids in a board's Done column, or `null` when the configuration does
 * not carry a readable column list.
 *
 * The last column with statuses mapped to it is the Done column, per Jira's own
 * board-configuration documentation. Reading it from the board, rather than
 * trusting a status named "Done", is what makes a board that maps an odd status
 * into its last column behave the same here as it does in Jira.
 *
 * Exported for tests: pure, and the parsing is where the bugs would hide.
 */
export function doneStatusIdsFromConfiguration(value: unknown): Set<string> | null {
  const columns = (value as { columnConfig?: { columns?: unknown } } | null)?.columnConfig
    ?.columns;
  if (!Array.isArray(columns)) return null;

  for (let index = columns.length - 1; index >= 0; index -= 1) {
    const statuses = (columns[index] as { statuses?: unknown } | null)?.statuses;
    if (!Array.isArray(statuses) || statuses.length === 0) continue;

    const ids = new Set<string>();
    for (const status of statuses) {
      const id = (status as { id?: unknown } | null)?.id;
      const text = typeof id === 'number' ? String(id) : typeof id === 'string' ? id.trim() : '';
      if (text !== '') ids.add(text);
    }
    if (ids.size > 0) return ids;
  }

  return null;
}

/**
 * Whether one issue sits in the board's Done column.
 *
 * When the board's Done status ids are known they win. When they are not, the
 * issue's own status category is the fallback. An issue whose status cannot be
 * read at all counts as unfinished: the endpoint was asked for exactly that
 * field, and carrying a finished issue forward is a smaller harm than leaving
 * unfinished work behind.
 */
function isDoneIssue(issue: unknown, doneIds: Set<string> | null): boolean {
  const status = (
    issue as { fields?: { status?: { id?: unknown; statusCategory?: { key?: unknown } } } } | null
  )?.fields?.status;
  if (!status || typeof status !== 'object') return false;

  if (doneIds) {
    const id =
      typeof status.id === 'number'
        ? String(status.id)
        : typeof status.id === 'string'
          ? status.id.trim()
          : '';
    if (id !== '') return doneIds.has(id);
  }

  const category = status.statusCategory;
  if (category && typeof category === 'object') {
    const key = (category as { key?: unknown }).key;
    if (typeof key === 'string') return key.toLowerCase() === 'done';
  }

  return false;
}

/**
 * The unfinished issue keys out of one page of a sprint's issue listing.
 *
 * Exported for tests: pure, and it owns the done/unfinished decision.
 */
export function unfinishedKeysFromIssuesPage(
  body: unknown,
  doneIds: Set<string> | null,
): string[] {
  const issues = (body as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return [];

  const keys: string[] = [];
  for (const issue of issues) {
    const key = (issue as { key?: unknown } | null)?.key;
    if (typeof key !== 'string' || key.trim() === '') continue;
    if (!isDoneIssue(issue, doneIds)) keys.push(key);
  }
  return keys;
}

/**
 * Every unfinished issue key in a sprint, oldest listing order first.
 *
 * Two reads: the board configuration for the Done column, then the sprint's own
 * issue listing, paged to its end. A configuration read that fails degrades to
 * the status-category fallback rather than stopping the close: not knowing the
 * board's exact Done column is not a reason to strand a whole sprint.
 */
export async function fetchUnfinishedIssueKeys(
  config: JiraConfig,
  boardId: number,
  sprintId: number,
  options: ListSprintsOptions = {},
): Promise<string[]> {
  let doneIds: Set<string> | null = null;
  try {
    const configuration = await jiraFetch<unknown>(
      config,
      `rest/agile/1.0/board/${boardId}/configuration`,
      { fetchImpl: options.fetchImpl },
    );
    doneIds = doneStatusIdsFromConfiguration(configuration);
  } catch {
    doneIds = null;
  }

  const keys: string[] = [];
  let startAt = 0;
  // A listing that exhausts the page cap has not been read to its end. The
  // caller must not close on a partial list, or the issues past the cap would
  // be left behind in the backlog.
  let completed = false;

  for (let page = 0; page < MAX_ISSUE_PAGES; page += 1) {
    const body = await jiraFetch<{ issues?: unknown; isLast?: unknown; total?: unknown }>(
      config,
      `rest/agile/1.0/sprint/${sprintId}/issue`,
      {
        search: { startAt, maxResults: ISSUE_PAGE_SIZE, fields: 'status' },
        fetchImpl: options.fetchImpl,
      },
    );

    const issues = Array.isArray(body.issues) ? body.issues : [];
    keys.push(...unfinishedKeysFromIssuesPage(body, doneIds));

    if (body.isLast === true || issues.length === 0) {
      completed = true;
      break;
    }
    // `total` is the reliable end signal when it is present; a short page is
    // only a fallback for responses that omit it.
    const total = typeof body.total === 'number' ? body.total : null;
    if (total !== null ? startAt + issues.length >= total : issues.length < ISSUE_PAGE_SIZE) {
      completed = true;
      break;
    }

    startAt += issues.length;
  }

  if (!completed) {
    throw new JiraError(
      'upstream',
      `Jira's issue listing for sprint ${sprintId} did not finish within ${MAX_ISSUE_PAGES} pages; refusing to close the sprint on a partial list.`,
    );
  }

  return keys;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function errorMessage(error: unknown): string {
  if (error instanceof JiraError) return error.message;
  return 'Jira did not accept the move.';
}

/** "2 unfinished issues are in the backlog", for a warning that has to say it. */
function backlogNote(count: number): string {
  return `${count} unfinished issue${count === 1 ? ' is' : 's are'} in the backlog`;
}

export interface MoveResult {
  /** How many issues were moved before any failure. */
  moved: number;
  /** Jira's reason, when a chunk was refused. `null` when all of them landed. */
  error: string | null;
}

/**
 * Send issue keys to a sprint, in Jira's 50-per-call limit.
 *
 * A failure returns what already landed rather than throwing, because the
 * sprint has already been closed by the time this runs and the caller needs to
 * report a partial carry honestly.
 */
export async function moveIssuesToSprint(
  config: JiraConfig,
  sprintId: number,
  keys: string[],
  options: ListSprintsOptions = {},
): Promise<MoveResult> {
  let moved = 0;
  for (const chunk of chunks(keys, MAX_MOVE_PER_CALL)) {
    try {
      await jiraFetch(config, `rest/agile/1.0/sprint/${sprintId}/issue`, {
        method: 'POST',
        body: { issues: chunk },
        fetchImpl: options.fetchImpl,
      });
      moved += chunk.length;
    } catch (error) {
      return { moved, error: errorMessage(error) };
    }
  }
  return { moved, error: null };
}

/** Where the unfinished issues went. */
export interface CarryTarget {
  id: number;
  name: string;
  /** True when this flow created the sprint, false when the board already had it. */
  created: boolean;
}

export interface EndSprintOutcome {
  /** The sprint that was just closed. */
  sprint: Sprint;
  /** Unfinished issues found before the close. */
  unfinished: number;
  /** How many of them reached a successor sprint. */
  moved: number;
  /** The successor, or `null` when there was nothing to carry or nowhere to put it. */
  target: CarryTarget | null;
  /** Why some or all unfinished issues stayed in the backlog. `null` on a clean run. */
  carryError: string | null;
}

export interface EndSprintRefused {
  ok: false;
  reason: CloseRefusal;
  message: string;
  state?: Sprint['state'];
}

export interface EndSprintDone {
  ok: true;
  outcome: EndSprintOutcome;
}

export type EndSprintResult = EndSprintDone | EndSprintRefused;

/**
 * Close one active sprint and carry its unfinished issues into the next.
 *
 * The guard is `readCloseTarget`'s: the sprint is re-read from the team's own
 * board listing and must be `active`. It runs before the issue read, so a
 * sprint that cannot close is refused without reading or writing anything.
 *
 * The successor is chosen from a listing taken *after* the close, not before:
 * a future sprint can be created, started or renamed while the issues are being
 * read, and the board as it is after the close is the one the issues land on.
 */
export async function endSprintAndCarryOver(
  config: JiraConfig,
  boardId: number,
  sprintId: number,
  options: ListSprintsOptions = {},
): Promise<EndSprintResult> {
  const target = await readCloseTarget(config, boardId, sprintId, options);
  if (!target.ok) return target;

  // Read before closing: closing is what scatters the unfinished issues to the
  // backlog, so after the close there is nothing left in the sprint to read.
  const unfinished = await fetchUnfinishedIssueKeys(config, boardId, sprintId, options);

  // The only close available is the one the validated target carries.
  const closed = await target.close();

  if (unfinished.length === 0) {
    return {
      ok: true,
      outcome: { sprint: closed, unfinished: 0, moved: 0, target: null, carryError: null },
    };
  }

  // Everything past this point happens after the close, so a failure must not
  // be thrown: the sprint is already closed and the user needs to be told what
  // became of the issues, not shown an end-sprint error.
  let board: Awaited<ReturnType<typeof listSprints>>;
  try {
    board = await listSprints(config, boardId, options);
  } catch (error) {
    return {
      ok: true,
      outcome: {
        sprint: closed,
        unfinished: unfinished.length,
        moved: 0,
        target: null,
        carryError: `${errorMessage(error)} Its ${backlogNote(unfinished.length)}.`,
      },
    };
  }

  // The board's next future sprint, in board order. Only when the board has no
  // future sprint at all does this flow create one.
  let successor: CarryTarget;
  const existing = board.future[0];
  if (existing) {
    successor = { id: existing.id, name: existing.name, created: false };
  } else {
    const name = nextSprintName(board.latestName);
    if (name === '') {
      return {
        ok: true,
        outcome: {
          sprint: closed,
          unfinished: unfinished.length,
          moved: 0,
          target: null,
          carryError: `${closed.name} closed, but no next sprint could be named. Its ${backlogNote(unfinished.length)}.`,
        },
      };
    }

    try {
      const created = await createSprint(config, boardId, name, options);
      successor = { id: created.id, name: created.name, created: true };
    } catch (error) {
      return {
        ok: true,
        outcome: {
          sprint: closed,
          unfinished: unfinished.length,
          moved: 0,
          target: null,
          carryError: `${errorMessage(error)} Its ${backlogNote(unfinished.length)}.`,
        },
      };
    }
  }

  const move = await moveIssuesToSprint(config, successor.id, unfinished, options);
  return {
    ok: true,
    outcome: {
      sprint: closed,
      unfinished: unfinished.length,
      moved: move.moved,
      target: successor,
      carryError:
        move.error === null
          ? null
          : `${move.error} ${move.moved} of ${unfinished.length} moved to ${successor.name}.`,
    },
  };
}
