/**
 * Form state -> retro output, in two flavours.
 *
 * `formatPlain` is the canonical output and must match the boss's real letter
 * character for character:
 *
 *     Rex Retro #31
 *
 *     Goals
 *     Investor FUP DONE
 *     K/O money flow USA chart WIP
 *     July Metrics DONE
 *
 *     Commitment 7
 *     Complete 6
 *
 *     Comments
 *     We need Cash contributions from our partners
 *
 *     Pluses
 *     July leak figured out (mostly)
 *
 *     Improvements
 *     Cut back Lux time on this until we get paid
 *
 * Note what the sample fixes: the title and "Goals" label are separated by one
 * blank line; goal status is an UPPERCASE token appended to the goal text; the
 * points lines are two separate "Commitment N" / "Complete N" lines rather
 * than one combined line.
 *
 * `formatHtml` is the same content for rich paste into Apple Mail. It carries
 * explicit empty-line elements rather than CSS margins, because mail clients
 * strip styles and would otherwise collapse every blank line out of the letter.
 * Both are pure functions of the form state; Copy writes both, `mailto:` uses
 * the plain one.
 */

import { bauBlockLines, type BauChecks, type BauItem } from './bau';

/**
 * Three states, because a goal that was neither finished nor worked on is a
 * real outcome the retro has to be able to say.
 */
export type GoalStatus = 'done' | 'wip' | 'not-done';

/** Where the status token sits relative to the goal text. */
export type StatusPosition = 'before' | 'after';

/** The sample letter puts the status after the text, so that is the default. */
export const DEFAULT_STATUS_POSITION: StatusPosition = 'after';

export interface Goal {
  text: string;
  status: GoalStatus;
  /**
   * Stable identity for the React key, minted when the row is created.
   *
   * Optional, and deliberately ignored by every function in this file: the
   * output is a pure function of text and status, so a goal built by a test or
   * an old draft without an id formats identically to one from the UI.
   *
   * It exists because the goal list *animates*. Keyed by array index, deleting
   * a row makes React mutate every row after it in place and unmount the last
   * one — so the row that visibly animates away is the last row, not the one
   * you deleted. A stable id makes the removed node the one that leaves.
   */
  id?: string;
}

export interface RetroState {
  title: string;
  goals: Goal[];
  completed: string;
  committed: string;
  comments: string;
  pluses: string;
  improvements: string;
  /** Optional so older callers and older drafts keep working. */
  statusPosition?: StatusPosition;
  /**
   * The team's standing BAU list and this sprint's ticks. Both optional: a team
   * that has never added a BAU item formats exactly the letter it always did,
   * which is what keeps the byte-exact fixtures valid.
   */
  bauItems?: BauItem[];
  bauChecks?: BauChecks;
}

/** Uppercase status tokens, matching the sample's "DONE" / "WIP". */
const STATUS_TOKEN: Record<GoalStatus, string> = {
  done: 'DONE',
  wip: 'WIP',
  'not-done': 'NOT DONE',
};

/** Human labels for the UI control; kept next to the tokens they map to. */
export const STATUS_LABEL: Record<GoalStatus, string> = {
  done: 'Done',
  wip: 'WIP',
  'not-done': 'Not done',
};

/** Cycle order for the status control: done -> wip -> not done -> done. */
export const STATUS_ORDER: readonly GoalStatus[] = ['done', 'wip', 'not-done'];

/**
 * Coerce anything (an old draft, a hand-edited localStorage blob) into a valid
 * status. Old drafts only ever stored 'done' or 'wip', both of which survive
 * unchanged; anything unrecognised falls back to 'wip', the neutral state.
 */
export function normalizeStatus(value: unknown): GoalStatus {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'done') return 'done';
  if (raw === 'wip') return 'wip';
  // Accept every spelling a draft or paste might carry for the third state.
  if (raw === 'not-done' || raw === 'not done' || raw === 'notdone' || raw === 'not_done') {
    return 'not-done';
  }
  return 'wip';
}

/** Monotonic fallback counter, so ids stay unique without `crypto`. */
let idCounter = 0;

/**
 * A fresh goal id.
 *
 * `crypto.randomUUID` is the intent, but it is only exposed on secure origins —
 * and this tool is also opened from plain-http dev servers and LAN addresses,
 * where `crypto.randomUUID` is simply absent. Falling back to a counter plus a
 * random suffix keeps ids unique within the session, which is all a React key
 * has to be.
 */
export function newGoalId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  idCounter += 1;
  return `g${idCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A new goal row: given text, the neutral status, and a fresh id. */
export function newGoal(text: string, status: GoalStatus = 'wip'): Goal {
  return { text, status: normalizeStatus(status), id: newGoalId() };
}

/**
 * Give every goal in a restored draft an id, keeping the ones it already has.
 *
 * Drafts written before goals carried ids are the whole reason this exists: a
 * migration that dropped them, or threw on them, would lose a retro someone had
 * already typed. So anything shaped even roughly like a goal is kept — text is
 * coerced, status is normalized, and only the id is minted.
 *
 * Ids are also de-duplicated. A hand-edited draft (or one copied between
 * sprints) can carry the same id twice, which would put React right back in the
 * mutate-in-place behaviour the ids exist to prevent.
 */
export function withGoalIds(goals: unknown): Goal[] {
  if (!Array.isArray(goals)) return [];
  const seen = new Set<string>();
  const out: Goal[] = [];
  for (const goal of goals) {
    if (!goal || typeof goal !== 'object') continue;
    const candidate = goal as Partial<Goal>;
    if (typeof candidate.text !== 'string') continue;
    const id =
      typeof candidate.id === 'string' && candidate.id !== '' && !seen.has(candidate.id)
        ? candidate.id
        : newGoalId();
    seen.add(id);
    out.push({ text: candidate.text, status: normalizeStatus(candidate.status), id });
  }
  return out;
}

/** Next status in the cycle, for a click on the status control. */
export function nextStatus(status: GoalStatus): GoalStatus {
  const index = STATUS_ORDER.indexOf(normalizeStatus(status));
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length]!;
}

export function normalizeStatusPosition(value: unknown): StatusPosition {
  return String(value ?? '').trim() === 'before' ? 'before' : DEFAULT_STATUS_POSITION;
}

/** Sections rendered after the points lines, in order. */
const SECTIONS: ReadonlyArray<{ label: string; key: 'comments' | 'pluses' | 'improvements' }> = [
  { label: 'Comments', key: 'comments' },
  { label: 'Pluses', key: 'pluses' },
  { label: 'Improvements', key: 'improvements' },
];

/** Each non-empty line of a textarea becomes one output line. */
function lines(value: string): string[] {
  return String(value ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function goalRows(goals: Goal[]): Goal[] {
  return (goals ?? []).filter((goal) => goal && String(goal.text ?? '').trim().length > 0);
}

/** One goal line: text and status token, ordered by the position setting. */
function goalLine(goal: Goal, position: StatusPosition): string {
  const token = STATUS_TOKEN[normalizeStatus(goal.status)];
  const text = String(goal.text).trim();
  return position === 'before' ? `${token} ${text}` : `${text} ${token}`;
}

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The letter as a list of blocks, each block a list of lines. Blank lines
 * between blocks are the renderers' job, so plain and HTML can never drift on
 * which sections appear or in what order.
 */
function blocks(state: RetroState): string[][] {
  const position = normalizeStatusPosition(state.statusPosition);
  const out: string[][] = [];

  // The title and Goals are separate blocks, producing exactly one blank line
  // when both exist without adding a leading or trailing blank when either is
  // absent.
  const title = String(state.title ?? '').trim();
  if (title !== '') out.push([title]);

  const goals = goalRows(state.goals);
  if (goals.length > 0) {
    out.push(['Goals', ...goals.map((goal) => goalLine(goal, position))]);
  }

  // Commitment and Complete are two lines in one block, and either may be
  // absent on its own — the sample shows both, a half-filled form shows one.
  const points: string[] = [];
  const committed = String(state.committed ?? '').trim();
  const completed = String(state.completed ?? '').trim();
  if (committed !== '') points.push(`Commitment ${committed}`);
  if (completed !== '') points.push(`Complete ${completed}`);
  if (points.length > 0) out.push(points);

  for (const section of SECTIONS) {
    const body = lines(state[section.key]);
    if (body.length === 0) continue;
    out.push([section.label, ...body]);
  }

  // BAU last, after Improvements: it is the standing inventory rather than
  // anything that happened this sprint, so it reads as the footer of the letter
  // rather than as one more thing to discuss. An empty list contributes no
  // block at all — header included — exactly like every other empty section,
  // which is what leaves a BAU-less team's letter byte-identical to before.
  const bau = bauBlockLines(state.bauItems ?? [], state.bauChecks ?? {});
  if (bau.length > 0) out.push(bau);

  return out;
}

/** Canonical plain-text output. */
export function formatPlain(state: RetroState): string {
  return blocks(state)
    .map((block) => block.join('\n'))
    .join('\n\n');
}

/**
 * Same content as `formatPlain`, as HTML that survives a paste into Apple Mail.
 *
 * Every line is its own `<div>`, and every blank line between blocks is an
 * explicit `<div><br></div>`. Mail clients strip `style` attributes and class
 * names, so a margin-based layout arrives as one undifferentiated wall of text;
 * an empty line made of real elements is the only kind that survives.
 */
export function formatHtml(state: RetroState): string {
  const rows: string[] = [];

  blocks(state).forEach((block, index) => {
    if (index > 0) rows.push('<div><br></div>');
    for (const line of block) rows.push(`<div>${escapeHtml(line)}</div>`);
  });

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;white-space:normal">${rows.join('')}</div>`;
}

/**
 * The unfinished goals, one per line, with no status tokens.
 *
 * This is not the retro letter — it is the *next* sprint's starting basis.
 * Anything that did not land (`wip` and `not-done`, i.e. everything but `done`)
 * carries over, and the lines are pasted straight into Jira's sprint-goal
 * field, where a "WIP" hanging off the end of every line is noise the boss
 * would only have to delete again. So the status decides *which* lines appear
 * and then says nothing further.
 *
 * Empty rows are skipped and order is preserved, matching `formatPlain`: the
 * carry-over list reads in the same order as the goals above it.
 */
export function formatUnfinishedGoals(goals: Goal[]): string {
  return goalRows(goals)
    .filter((goal) => normalizeStatus(goal.status) !== 'done')
    .map((goal) => String(goal.text).trim())
    .join('\n');
}

/** Title from a team's template, e.g. "Rex Retro #{sprint}". */
export function buildTitle(template: string, sprint: string): string {
  return String(template ?? '').replace(/\{sprint\}/g, String(sprint ?? '').trim());
}

/** `mailto:` URL: recipients + subject from the title + plain-text body. */
export function buildMailto(recipients: string[], subject: string, body: string): string {
  const to = (recipients ?? [])
    .map((address) => String(address).trim())
    .filter((address) => address.length > 0)
    .join(',');
  const params = new URLSearchParams();
  params.set('subject', String(subject ?? '').trim());
  params.set('body', body ?? '');
  // URLSearchParams encodes spaces as "+", which mail clients render literally.
  const query = params.toString().replace(/\+/g, '%20');
  return `mailto:${encodeURIComponent(to).replace(/%2C/g, ',').replace(/%40/g, '@')}?${query}`;
}
