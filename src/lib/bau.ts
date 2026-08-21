/**
 * BAU — "business as usual".
 *
 * The boss added a final section to his letter: a checkbox list of standing
 * work that recurs every sprint, ticked or not depending on how the fortnight
 * went. His own format, verbatim from the letter (note the sloppy spacing —
 * `- []` with no space inside the brackets, and `- []Marketing Video` with none
 * after them either):
 *
 *     BAU
 *     - [] RFP
 *     - []Marketing Video
 *     - [] linkedin post.
 *
 * ## The model: a persistent list, per-sprint ticks
 *
 * The two halves of a BAU item live in different places, and that split is the
 * whole design:
 *
 *   - **The item list persists per team**, across every sprint, in its own
 *     localStorage key. It is a standing inventory — "the things we always do"
 *     — curated occasionally: an item is added when a new recurring commitment
 *     appears and removed when it stops being one. It is emphatically *not*
 *     part of a sprint's draft, because retyping the same six items every
 *     fortnight is exactly the manual work this tool exists to delete.
 *   - **The ticks are per sprint**, stored in that sprint's draft alongside the
 *     goals and the notes. "Did we do the podcast?" is a question about one
 *     fortnight and has a different answer the next. A new sprint therefore
 *     starts with every box clear rather than inheriting last sprint's answers,
 *     which would be worse than useless: a stale tick reads as a claim.
 *
 * So `BauItem` carries only identity and text. Checked state is a separate
 * `Record<id, boolean>` that lives in the draft, and an item with no entry in
 * it is simply unchecked.
 */

import { newGoalId } from './format';

/**
 * One standing item. Text and identity only — whether it was *done* this sprint
 * is not a property of the item, it is a property of the sprint (see the note
 * above), so it is deliberately absent from this type.
 */
export interface BauItem {
  id: string;
  text: string;
}

/**
 * Which items are ticked in one sprint, keyed by item id. A missing key means
 * unchecked, so a freshly-added item needs no entry and a new sprint's draft
 * can legitimately be `{}`.
 */
export type BauChecks = Record<string, boolean>;

/** A fresh item. Ids come from the same minter the goal rows use. */
export function newBauItem(text: string): BauItem {
  return { id: newGoalId(), text };
}

/**
 * Coerce anything — a restored draft, a hand-edited localStorage blob — into a
 * usable item list.
 *
 * Defended the same way `withGoalIds` defends goals, and for the same reason:
 * this list is curated by hand over months, so dropping it on a malformed entry
 * would lose real work. Anything shaped roughly like an item is kept, ids are
 * minted where missing and de-duplicated where repeated (a duplicate id would
 * make two rows share one checkbox), and blank text is dropped — an item with
 * no text is not a thing anybody can tick.
 */
export function normalizeBauItems(value: unknown): BauItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: BauItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<BauItem>;
    if (typeof candidate.text !== 'string') continue;
    const text = candidate.text.trim();
    if (text === '') continue;
    const id =
      typeof candidate.id === 'string' && candidate.id !== '' && !seen.has(candidate.id)
        ? candidate.id
        : newGoalId();
    seen.add(id);
    out.push({ id, text });
  }
  return out;
}

/** Coerce a restored checks map, keeping only real `true` entries. */
export function normalizeBauChecks(value: unknown): BauChecks {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: BauChecks = {};
  for (const [key, checked] of Object.entries(value as Record<string, unknown>)) {
    if (checked === true) out[key] = true;
  }
  return out;
}

/**
 * The key two items are considered "the same" under: trimmed and case-folded.
 *
 * Merging on this rather than on exact text is what makes the prefill safe to
 * run repeatedly. Jira's goal text is retyped by hand every sprint, so "RFP"
 * one fortnight and "rfp " the next are the same standing item with different
 * typing, and treating them as two would grow a duplicate list forever.
 */
export function bauKey(text: string): string {
  return String(text ?? '').trim().toLowerCase();
}

// ------------------------------------------------------------------ parsing

/**
 * The `BAU` header: a line that is *exactly* the word, case-insensitive, with
 * an optional trailing colon and nothing else.
 *
 * Deliberately strict. The Marketing board has a real goal line reading
 * "BAU (business as usual)" which the existing splitter turns into an ordinary
 * goal row, and there are byte-exact tests pinning that. A loose match would
 * silently swallow it — so a header is the bare word or nothing.
 */
const BAU_HEADER = /^\s*bau\s*:?\s*$/i;

/**
 * A checkbox line, in every spelling the boss actually types.
 *
 * `- [] RFP`, `- [ ] RFP`, `- [x] RFP`, `-[]RFP`, `* [X] RFP`. The bullet, the
 * space inside the brackets and the space after them are all optional, because
 * all three are optional in the source letter. The captured group is the tick.
 */
const BAU_CHECKBOX = /^\s*[-–—*+]\s*\[\s*([xX]?)\s*\]\s*(.*)$/;

export interface ParsedBau {
  /** The item texts found under the header, in order, blanks dropped. */
  items: string[];
  /** The subset of `items` whose box was ticked. */
  checked: string[];
}

export interface SplitBauResult {
  /**
   * The goal text with the BAU block removed, ready for the ordinary splitter.
   * Everything outside the block is untouched, newlines and all.
   */
  rest: string;
  /** The parsed block, or `null` when the text carries no BAU header. */
  bau: ParsedBau | null;
}

/**
 * Lift a BAU block out of a sprint-goal blob.
 *
 * The block starts at a bare `BAU` line and runs for as long as the following
 * lines are checkbox lines (blank lines are tolerated *inside* it, so a stray
 * empty line does not truncate the list). The first line that is neither ends
 * the block and goes back to being an ordinary goal line.
 *
 * ## Why this is a separate function from `splitGoals`
 *
 * `splitGoals` already strips checkbox markers into goal rows, and that
 * behaviour is *load-bearing* for the Marketing board, where the goal field is
 * a flat list of `- [ ] Podcast` items that genuinely are that sprint's goals.
 * Three fixture tests pin it. So the BAU feature does not change the splitter:
 * it runs *before* it, removes only the lines under a real `BAU` header, and
 * hands the remainder over unchanged. A checkbox line not under a header still
 * becomes a goal row, exactly as it did before.
 */
export function splitBauBlock(input: string): SplitBauResult {
  const text = String(input ?? '');
  if (text === '') return { rest: text, bau: null };

  const lines = text.split(/\r\n|\r|\n/);
  const headerAt = lines.findIndex((line) => BAU_HEADER.test(line));
  if (headerAt === -1) return { rest: text, bau: null };

  const items: string[] = [];
  const checked: string[] = [];
  let end = headerAt + 1;

  for (; end < lines.length; end += 1) {
    const line = lines[end]!;
    // A blank line inside the block is a visual separator, not the end of it.
    if (line.trim() === '') continue;
    const match = BAU_CHECKBOX.exec(line);
    if (!match) break;
    const itemText = match[2]!.trim();
    if (itemText === '') continue;
    items.push(itemText);
    if (match[1] !== '') checked.push(itemText);
  }

  // A header with no checkbox lines under it is not a BAU block — it is a goal
  // line that happens to read "BAU". Leave the text alone entirely.
  if (items.length === 0) return { rest: text, bau: null };

  const rest = [...lines.slice(0, headerAt), ...lines.slice(end)].join('\n');
  return { rest, bau: { items, checked } };
}

export interface MergeBauResult {
  items: BauItem[];
  checks: BauChecks;
  /** How many items the parse added to the team's standing list. */
  added: number;
}

/**
 * Merge a parsed block into the team's standing list, and derive this sprint's
 * ticks from it.
 *
 * Additive by design, in both directions:
 *
 *   - An item Jira mentions that the team's list does not have is **added**.
 *   - An item the team's list has that Jira does not mention is **kept**. A
 *     prefill is a read of one sprint's goal field, and the boss routinely
 *     omits items he did not touch; deleting the standing inventory because a
 *     fortnight's note was terse would destroy months of curation. Removal is a
 *     deliberate click, never a side effect of a prefill.
 *
 * Matching is on `bauKey` — trimmed, case-folded — so re-typed casing does not
 * fork an item into two. The existing item keeps its own text and id: the list
 * is what the team curated, and a prefill is not a rename.
 *
 * The returned checks are a **fresh map**, not a merge onto the previous
 * sprint's. Ticks belong to one sprint (see the header note), so anything not
 * ticked in this goal text is unticked here.
 */
export function mergeBauParse(existing: BauItem[], parsed: ParsedBau): MergeBauResult {
  const items = [...existing];
  const byKey = new Map(items.map((item) => [bauKey(item.text), item]));
  let added = 0;

  for (const text of parsed.items) {
    const key = bauKey(text);
    if (key === '' || byKey.has(key)) continue;
    const item = newBauItem(text);
    items.push(item);
    byKey.set(key, item);
    added += 1;
  }

  const checks: BauChecks = {};
  for (const text of parsed.checked) {
    const item = byKey.get(bauKey(text));
    if (item) checks[item.id] = true;
  }

  return { items, checks, added };
}

// --------------------------------------------------------------- formatting

/** The section header, in the letter and in a pushed sprint goal alike. */
export const BAU_HEADER_LINE = 'BAU';

/**
 * One item as a normalized checkbox line: `- [ ] RFP` or `- [x] RFP`.
 *
 * Normalized regardless of how it arrived. The boss's own letter mixes `- []`,
 * `- []Marketing Video` and `- [ ] linkedin post.` in a single block; the
 * output picks one spelling — the conventional Markdown one — and uses it for
 * every line, so the letter reads as a list rather than as three attempts at
 * one.
 */
export function bauLine(text: string, checked: boolean): string {
  return `- [${checked ? 'x' : ' '}] ${String(text ?? '').trim()}`;
}

/**
 * The BAU block as output lines: the header, then one line per item.
 *
 * Returns `[]` for an empty list, which is what keeps the section out of the
 * letter entirely — header included — the same way every other empty section is
 * skipped. That is also what keeps the existing byte-exact fixtures valid: a
 * team with no BAU items produces exactly the letter it always did.
 */
export function bauBlockLines(items: BauItem[], checks: BauChecks = {}): string[] {
  const rows = (items ?? []).filter((item) => item && String(item.text ?? '').trim() !== '');
  if (rows.length === 0) return [];
  return [
    BAU_HEADER_LINE,
    ...rows.map((item) => bauLine(item.text, checks?.[item.id] === true)),
  ];
}
