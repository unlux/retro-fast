/**
 * Form state -> retro output, in two flavours.
 *
 * `formatPlain` is the canonical output and must match the boss's Apple Notes
 * template character for character:
 *
 *     Rex Retro — Sprint 42
 *
 *     done Goal one text
 *     wip  Goal two text
 *
 *     Completed: 29 / Committed: 34
 *
 *     Comments
 *     First comment line
 *     Second comment line
 *
 *     Pluses
 *     ...
 *
 *     Improvements
 *     ...
 *
 * `formatHtml` is the same content with a bold heading and bold section labels,
 * so Apple Mail pastes rich while Notes and Slack paste clean. Both are pure
 * functions of the form state; Copy writes both, `mailto:` uses the plain one.
 */

export type GoalStatus = 'done' | 'wip';

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
}

/** Status labels, padded so goal text lines up in a monospace-ish read. */
const STATUS_LABEL: Record<GoalStatus, string> = {
  done: 'done',
  wip: 'wip ',
};

/** Sections rendered after the points line, in order. */
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

function pointsValue(value: string): string {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? '—' : trimmed;
}

export function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Canonical plain-text output. */
export function formatPlain(state: RetroState): string {
  const blocks: string[] = [];

  const title = String(state.title ?? '').trim();
  if (title !== '') blocks.push(title);

  const goals = goalRows(state.goals);
  if (goals.length > 0) {
    blocks.push(
      goals
        .map((goal) => `${STATUS_LABEL[goal.status] ?? STATUS_LABEL.wip} ${String(goal.text).trim()}`)
        .join('\n'),
    );
  }

  const completed = String(state.completed ?? '').trim();
  const committed = String(state.committed ?? '').trim();
  if (completed !== '' || committed !== '') {
    blocks.push(`Completed: ${pointsValue(completed)} / Committed: ${pointsValue(committed)}`);
  }

  for (const section of SECTIONS) {
    const body = lines(state[section.key]);
    if (body.length === 0) continue;
    blocks.push([section.label, ...body].join('\n'));
  }

  return blocks.join('\n\n');
}

/** Same content as `formatPlain`, with a bold heading and bold section labels. */
export function formatHtml(state: RetroState): string {
  const blocks: string[] = [];

  const title = String(state.title ?? '').trim();
  if (title !== '') {
    blocks.push(`<p><strong>${escapeHtml(title)}</strong></p>`);
  }

  const goals = goalRows(state.goals);
  if (goals.length > 0) {
    // `<br>`, not `<div>`: a div inside a p is invalid HTML, and a parser that
    // sees one closes the paragraph early and strays the rest out of the block.
    // Line breaks inside the paragraph render the same and stay valid.
    const rows = goals
      .map((goal) => {
        const label = goal.status === 'done' ? 'done' : 'wip';
        return `<strong>${label}</strong> ${escapeHtml(String(goal.text).trim())}`;
      })
      .join('<br />');
    blocks.push(`<p>${rows}</p>`);
  }

  const completed = String(state.completed ?? '').trim();
  const committed = String(state.committed ?? '').trim();
  if (completed !== '' || committed !== '') {
    blocks.push(
      `<p>Completed: ${escapeHtml(pointsValue(completed))} / Committed: ${escapeHtml(pointsValue(committed))}</p>`,
    );
  }

  for (const section of SECTIONS) {
    const body = lines(state[section.key]);
    if (body.length === 0) continue;
    const rows = body.map((line) => escapeHtml(line)).join('<br />');
    blocks.push(`<p><strong>${section.label}</strong><br />${rows}</p>`);
  }

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">${blocks.join('')}</div>`;
}

/** Title from a team's template, e.g. "Rex Retro — Sprint {sprint}". */
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
