/**
 * The Plan tab's text: what next sprint's Jira goal field will contain.
 *
 * The retro tab answers "what happened"; this answers "what's next". The output
 * is a single plain-text blob because that is what Jira's sprint `goal` field
 * is — one string, no formatting, no markup (multiline is an unfulfilled Jira
 * feature request, but newlines do round-trip, which is why the boards' goals
 * read as lists at all).
 *
 * ## Why the preview is the push
 *
 * `buildPlanText` is the *only* function that composes this text, and both the
 * on-screen preview and the request body call it with the same arguments. There
 * is no second code path that "renders it for display" — a preview that is
 * assembled separately from what is sent is a preview that eventually lies, and
 * this one is showing the user something irreversible about to be written into
 * a shared Jira board. What you see is byte-for-byte what Jira gets.
 */

import { bauBlockLines, type BauItem } from './bau';
import { formatUnfinishedGoals, type Goal } from './format';

/** Each non-empty line of the composer becomes one goal line. */
export function planLines(value: string): string[] {
  return String(value ?? '')
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * The text to push: the goal lines, then the BAU block after a blank line.
 *
 * The BAU items are appended **all unchecked**. A sprint that has not started
 * has by definition done none of its standing work yet, and a `[x]` carried
 * over from last sprint would be a false claim sitting in the board's goal
 * field for a fortnight. The ticks are the retro's job, at the other end.
 *
 * Either half may be absent: no goal lines and no BAU items gives `''`, which
 * the push guard treats as nothing to do.
 */
export function buildPlanText(goalText: string, bauItems: BauItem[] = []): string {
  const blocks: string[] = [];

  const goals = planLines(goalText);
  if (goals.length > 0) blocks.push(goals.join('\n'));

  // `bauBlockLines` with no checks map: every box unchecked.
  const bau = bauBlockLines(bauItems ?? []);
  if (bau.length > 0) blocks.push(bau.join('\n'));

  return blocks.join('\n\n');
}

/**
 * The composer's starting content, seeded from the retro's unfinished goals.
 *
 * Identical to what "Copy unfinished goals" puts on the clipboard — same
 * function, so the two can never drift — because they answer the same question
 * from opposite ends: what did not land, and therefore what carries over.
 * Status tokens are absent by construction; a trailing "WIP" on every line of a
 * sprint goal is noise the boss would only delete again.
 */
export function seedPlanFromGoals(goals: Goal[]): string {
  return formatUnfinishedGoals(goals ?? []);
}

/**
 * The two ways a push can combine with a goal the target sprint already has.
 *
 * `append` keeps what is there and adds the new text after a blank line — the
 * safe one, and what somebody usually means when a sprint already has a goal
 * they wrote earlier. `replace` is the new text alone.
 *
 * Both are offered as one-tap *fills* of an editable box rather than as direct
 * actions: the result of either is still shown, still editable, and still has
 * to be pushed deliberately.
 */
export type MergeMode = 'append' | 'replace';

/** Combine an existing goal with the planned text. */
export function mergeGoalText(existing: string, planned: string, mode: MergeMode): string {
  const current = String(existing ?? '').trim();
  const next = String(planned ?? '').trim();
  if (mode === 'replace' || current === '') return next;
  if (next === '') return current;
  return `${current}\n\n${next}`;
}
