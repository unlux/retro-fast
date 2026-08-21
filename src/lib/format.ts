/**
 * Form state -> retro output, in two flavours.
 *
 * `formatPlain` is the canonical output and must match the boss's real letter
 * character for character:
 *
 *     REx Retro #31
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
 * Note what the sample fixes: the title is followed *immediately* by the
 * "Goals" label with no blank line; goal status is an UPPERCASE token appended
 * to the goal text; the points lines are two separate "Commitment N" /
 * "Complete N" lines rather than one combined line.
 *
 * `formatHtml` is the same content for rich paste into Apple Mail. It carries
 * explicit empty-line elements rather than CSS margins, because mail clients
 * strip styles and would otherwise collapse every blank line out of the letter.
 * Both are pure functions of the form state; Copy writes both, `mailto:` uses
 * the plain one.
 */

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

  // The title and the Goals block are one block: the sample has no blank line
  // between "REx Retro #31" and "Goals".
  const head: string[] = [];
  const title = String(state.title ?? '').trim();
  if (title !== '') head.push(title);

  const goals = goalRows(state.goals);
  if (goals.length > 0) {
    head.push('Goals', ...goals.map((goal) => goalLine(goal, position)));
  }
  if (head.length > 0) out.push(head);

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

/** Title from a team's template, e.g. "REx Retro #{sprint}". */
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
