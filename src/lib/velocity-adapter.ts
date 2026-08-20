/**
 * Velocity via the undocumented greenhopper report.
 *
 * `GET /rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId={boardId}` is the
 * only way to get Jira's own commitment/completed numbers: commitment is a
 * snapshot taken at sprint start and cannot be faithfully recomputed from the
 * documented APIs afterwards.
 *
 * Because Atlassian neither documents nor supports this endpoint, the adapter's
 * contract is *graceful degradation*: any failure at all — endpoint removed,
 * auth lost, board unsupported, sprint absent, shape changed — returns
 * `{ available: false }`. The form then leaves the two point fields blank and
 * the user types them, exactly as in manual mode. Failure is silent-but-labeled,
 * never an error the user has to interpret.
 *
 * The one exception is a bad token: that is worth surfacing, since it is fixable
 * and it breaks everything else too, so it propagates as a `JiraError` and the
 * route turns it into a distinct message.
 *
 * Note the quirk that makes this fiddly: with an invalid token the greenhopper
 * endpoint answers **403**, not the 401 the documented Agile API returns
 * (verified against the live site). Treating 403 here as merely "unavailable"
 * would let an expired token degrade silently forever, so both statuses are
 * treated as auth failures — the cost is that a genuine permission problem on
 * one board also surfaces as an auth message, which is the safer confusion.
 */

import { JiraError, jiraFetch, type JiraConfig } from './jira';

export type VelocityResult =
  | { available: true; committed: number; completed: number }
  | { available: false };

const UNAVAILABLE: VelocityResult = { available: false };

interface StatValue {
  value?: unknown;
}

interface StatEntry {
  estimated?: StatValue;
  completed?: StatValue;
}

interface VelocityResponse {
  /**
   * Keyed by sprint id — an unordered plain object, NOT an array and NOT sorted
   * by recency. Always look up by a sprint id obtained from the Agile API;
   * iteration order means nothing.
   */
  velocityStatEntries?: Record<string, StatEntry>;
}

/**
 * Greenhopper reports points as floats ("7.0"); accept string or number.
 * A blank or whitespace-only string is *missing*, not zero — `Number('')` is 0,
 * which would silently prefill 0 points for a sprint that has none.
 */
function points(stat: StatValue | undefined): number | null {
  const raw = stat?.value;
  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * Pull one sprint's committed/completed out of a velocity payload.
 *
 * Exported for tests: this is the part with real logic (unordered dict lookup,
 * missing-entry handling), and it is pure.
 */
export function readVelocityEntry(body: unknown, sprintId: number): VelocityResult {
  const entries = (body as VelocityResponse | null)?.velocityStatEntries;
  if (!entries || typeof entries !== 'object') return UNAVAILABLE;

  // Strict lookup by id. Active sprints legitimately have no entry — velocity
  // snapshots only exist once a sprint closes — which is a normal miss, not an
  // error.
  const entry = (entries as Record<string, StatEntry>)[String(sprintId)];
  if (!entry) return UNAVAILABLE;

  const committed = points(entry.estimated);
  const completed = points(entry.completed);
  if (committed === null || completed === null) return UNAVAILABLE;

  return { available: true, committed, completed };
}

/** Statuses that mean "the credentials are the problem", not "no data". */
function isAuthFailure(error: unknown): boolean {
  return (
    error instanceof JiraError && (error.kind === 'unauthorized' || error.kind === 'forbidden')
  );
}

/**
 * Velocity for one sprint on one board.
 * Returns `{ available: false }` on any failure except an auth failure, which
 * rethrows as an `unauthorized` error for the route to report.
 */
export async function fetchVelocity(
  config: JiraConfig,
  boardId: number,
  sprintId: number,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<VelocityResult> {
  try {
    const body = await jiraFetch<VelocityResponse>(
      config,
      'rest/greenhopper/1.0/rapid/charts/velocity',
      { search: { rapidViewId: boardId }, fetchImpl: options.fetchImpl },
    );
    return readVelocityEntry(body, sprintId);
  } catch (error) {
    if (isAuthFailure(error)) {
      // Normalize greenhopper's 403 into the one kind the UI knows about.
      throw new JiraError(
        'unauthorized',
        'Jira rejected the credentials — the API token is invalid or has expired.',
        (error as JiraError).status,
      );
    }
    return UNAVAILABLE;
  }
}
