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

/**
 * The ordered sprint list the report needs.
 *
 * The greenhopper payload carries a `sprints` array alongside the entries dict,
 * and it *is* ordered — newest first — which is the one place recency can be
 * read from this endpoint at all. Verified against all three live boards:
 * `sprints[0]` is the most recent sprint on each. Names come from here too, so
 * the report can label an x-axis without a second Agile call.
 */
interface RawVelocitySprint {
  id?: unknown;
  name?: unknown;
  state?: unknown;
}

interface VelocityResponse {
  /**
   * Keyed by sprint id — an unordered plain object, NOT an array and NOT sorted
   * by recency. Always look up by a sprint id obtained from the Agile API;
   * iteration order means nothing.
   */
  velocityStatEntries?: Record<string, StatEntry>;
  /** Newest first; see `RawVelocitySprint`. */
  sprints?: RawVelocitySprint[];
}

/** One sprint's row in the velocity report. */
export interface VelocityPoint {
  sprintId: number;
  name: string;
  committed: number;
  completed: number;
}

export type VelocitySeriesResult =
  | { available: true; series: VelocityPoint[] }
  | { available: false };

const NO_SERIES: VelocitySeriesResult = { available: false };

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

/**
 * The whole velocity series out of one payload, oldest → newest.
 *
 * Same strictness as `readVelocityEntry`, applied per row: a sprint listed in
 * `sprints` with no entry in the unordered dict — or an entry missing either
 * number — is *dropped*, not zero-filled. Greenhopper only computes a snapshot
 * when a sprint closes, so an active sprint legitimately has no entry, and
 * plotting it as a pair of zero bars would invent a catastrophic sprint that
 * never happened.
 *
 * Order comes from `sprints`, reversed. That array is the endpoint's only
 * recency signal (the entries dict is explicitly unordered), and it arrives
 * newest-first on every live board. Sprint ids are *not* a fallback: they do
 * not increase with start date on these boards — REX sprint 30 has a higher id
 * than sprint 31's predecessor.
 *
 * Exported for tests: pure, and the part with the real logic.
 */
export function readVelocitySeries(body: unknown): VelocitySeriesResult {
  const payload = body as VelocityResponse | null;
  const entries = payload?.velocityStatEntries;
  const sprints = payload?.sprints;
  if (!entries || typeof entries !== 'object') return NO_SERIES;
  if (!Array.isArray(sprints)) return NO_SERIES;

  const series: VelocityPoint[] = [];
  // Reversed: the payload lists newest first, a chart reads oldest → newest.
  for (const raw of [...sprints].reverse()) {
    if (!raw || typeof raw !== 'object') continue;

    // Same guard as sprints.ts: `Number(null)`/`Number(true)`/`Number([])` are
    // all finite and would invent sprint ids of 0 and 1.
    const id =
      typeof raw.id === 'number'
        ? raw.id
        : typeof raw.id === 'string' && raw.id.trim() !== ''
          ? Number(raw.id)
          : NaN;
    if (!Number.isFinite(id)) continue;

    const entry = (entries as Record<string, StatEntry>)[String(id)];
    if (!entry) continue;

    const committed = points(entry.estimated);
    const completed = points(entry.completed);
    if (committed === null || completed === null) continue;

    series.push({
      sprintId: id,
      name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : `Sprint ${id}`,
      committed,
      completed,
    });
  }

  // An empty series is not a chart. Degrade rather than render bare axes.
  return series.length === 0 ? NO_SERIES : { available: true, series };
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

/**
 * The full velocity series for one board — the report's data.
 *
 * Deliberately the same call as `fetchVelocity`: greenhopper returns all ~12
 * sprints in a single response, so the report costs no extra Jira round trip
 * beyond the one the points prefill already makes. Degradation contract is
 * identical — any failure but a bad token becomes `{ available: false }`, and
 * the dialog then says the report is unavailable rather than showing an error.
 */
export async function fetchVelocitySeries(
  config: JiraConfig,
  boardId: number,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<VelocitySeriesResult> {
  try {
    const body = await jiraFetch<VelocityResponse>(
      config,
      'rest/greenhopper/1.0/rapid/charts/velocity',
      { search: { rapidViewId: boardId }, fetchImpl: options.fetchImpl },
    );
    return readVelocitySeries(body);
  } catch (error) {
    if (isAuthFailure(error)) {
      throw new JiraError(
        'unauthorized',
        'Jira rejected the credentials — the API token is invalid or has expired.',
        (error as JiraError).status,
      );
    }
    return NO_SERIES;
  }
}
