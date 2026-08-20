/**
 * Forgiving goal splitter.
 *
 * Jira's sprint `goal` field is one plain-text blob, so people delimit multiple
 * goals however they feel like on the day. The same splitter backs the paste-box
 * in the manual form.
 *
 * Tuned against the real goal text on the three live boards (see
 * docs/research/jira-discovery.md). What that data actually shows:
 *
 *   - **Newline is the delimiter**, on every sprint of every board. Not one
 *     sprint used ";", "•", or "1. 2. 3." numbering. The single-line fallbacks
 *     below are kept for the paste-box (people paste from anywhere) but are
 *     effectively dead code for Jira goals.
 *   - Blank lines appear as visual separators and must be dropped.
 *   - The Marketing board routinely embeds **Markdown checkboxes** under a "BAU"
 *     line — `- [ ] Podcast`, `- [ ] Video Content`, … — and occasionally
 *     **tab-indented sub-items** under a header line ("Decision needed").
 *   - Free text is arbitrary: an older Skillion Labs sprint contains a literal
 *     `<ambition>` tag line and trailing "WIP"/"NOT" annotations. Nothing is
 *     parsed or stripped beyond list decoration — annotations are the author's
 *     words and stay.
 *
 * Two deliberate choices for the Marketing patterns:
 *
 *   1. **Checkbox items become their own rows**, marker stripped: `- [ ] Podcast`
 *      -> `Podcast`. They are flat siblings of the surrounding lines (no
 *      indentation), and each is a real, independently done/wip work item — which
 *      is exactly what a goal row is.
 *   2. **Tab-indented sub-items attach to their parent header**:
 *      "Decision needed" + "\tTikTok" -> `Decision needed — TikTok`. On its own
 *      "TikTok" is meaningless in an emailed retro, and the bare header is not
 *      something you mark done. Joining keeps one line per real item and keeps
 *      the context. The header is dropped once it has children (it is a label,
 *      not a goal); a header with no children stays as an ordinary row.
 *
 * Rows stay editable in the UI, so a bad split still only costs one manual fix.
 */

/**
 * Leading list/bullet decoration to strip off an individual row.
 *
 * A numbered marker must be followed by whitespace or end-of-line, otherwise
 * ordinary retro text like "1.5x conversion" or "2)fix" loses its first digits.
 * Bullet characters need no such guard — they are never part of a word.
 */
const LEADING_MARKER = /^\s*(?:[-–—*•▪‣◦]+\s*|\(?\d+\s*[.)](?=\s|$)\s*)/;

/** Markdown checkbox: "- [ ] ", "* [x] ", "- []". Checked state is ignored. */
const CHECKBOX_MARKER = /^\s*[-–—*+]\s*\[\s*[xX]?\s*\]\s*/;

/** A numbered marker anywhere in a single-line blob, e.g. "2." or "(3)". */
const NUMBERED_SPLIT = /(?:^|\s)\(?\d+[.)]\s*/;

const BULLET_SPLIT = /[•▪‣◦*]+/;

const DASH_SPLIT = /\s+[-–—]+\s+/;

/** Joins a parent header to an indented child: "Decision needed — TikTok". */
const PARENT_SEPARATOR = ' — ';

function clean(row: string): string {
  const withoutCheckbox = row.replace(CHECKBOX_MARKER, '');
  // A checkbox is complete decoration on its own; don't then eat a leading
  // "-" that belongs to the text (e.g. "- [ ] - dash-first item" is not real,
  // but "- [ ] 5 hot tips" must keep its "5").
  const stripped =
    withoutCheckbox === row ? row.replace(LEADING_MARKER, '') : withoutCheckbox;
  return stripped.trim();
}

function finish(rows: string[]): string[] {
  return rows.map(clean).filter((row) => row.length > 0);
}

/** True when a line is indented (tab or 2+ spaces) under a preceding header. */
function isIndented(line: string): boolean {
  return /^(?:\t| {2,})/.test(line) && line.trim().length > 0;
}

/**
 * Multi-line path: split on newlines, drop blanks, strip decoration, and fold
 * tab-indented sub-items into their parent line.
 */
function splitLines(text: string): string[] {
  const rawLines = text.split(/\r\n|\r|\n/);
  const rows: string[] = [];

  /** Index in `rows` of the line children should attach to, if any. */
  let parentIndex: number | null = null;
  /** Parent text, kept separately so repeated children all get the prefix. */
  let parentText = '';
  /** Whether the parent has already absorbed a child (so it isn't re-emitted). */
  let parentUsed = false;

  for (const rawLine of rawLines) {
    if (rawLine.trim() === '') {
      // A blank line ends any parent/child grouping as well as being dropped.
      // `parentText` must be cleared too: it is what the indent check reads, so
      // leaving it set would re-attach a later orphan to the ended group.
      parentIndex = null;
      parentText = '';
      parentUsed = false;
      continue;
    }

    const indented = isIndented(rawLine);
    const text = clean(rawLine);
    if (text === '') continue;

    if (indented && parentText !== '') {
      if (parentUsed) {
        rows.push(`${parentText}${PARENT_SEPARATOR}${text}`);
      } else {
        // First child replaces the bare header in place, keeping order stable.
        rows[parentIndex!] = `${parentText}${PARENT_SEPARATOR}${text}`;
        parentUsed = true;
      }
      continue;
    }

    rows.push(text);
    // Any non-indented line can head a group; only tab/space-indented lines
    // that follow will actually use it.
    parentIndex = rows.length - 1;
    parentText = text;
    parentUsed = false;
  }

  return rows;
}

/**
 * Split a blob of goal text into individual goal rows.
 * Always returns trimmed, non-empty rows; returns `[]` for blank input.
 *
 * Strategy, first match wins:
 *   1. Newlines, if the text contains any (the real-world case).
 *   2. Numbered list markers ("1. ", "2)", "(3)") — before the other
 *      single-line delimiters so "1. Ship X - the new one; 2. Fix Y" splits
 *      into two goals, not four.
 *   3. Semicolons.
 *   4. Bullet characters: • ▪ ‣ ◦ *
 *   5. Dash bullets (" - ", " – ", " — ") — whitespace-delimited only, so
 *      hyphenated words and "A-B testing" survive.
 *   6. Otherwise the whole string is one goal.
 */
export function splitGoals(input: string): string[] {
  if (typeof input !== 'string') return [];

  // Only the ends are trimmed: interior indentation carries the sub-item
  // structure the multi-line path depends on.
  const text = input.replace(/^[\s﻿]+|[\s﻿]+$/g, '');
  if (text === '') return [];

  // 1. Newlines win whenever they exist.
  if (/\r|\n/.test(text)) return splitLines(text);

  // 2. Numbered lists: needs at least a "2." to be a list rather than a
  //    sentence that happens to start with "1.".
  const numbered = text.split(NUMBERED_SPLIT);
  if (numbered.length > 2 || (numbered.length === 2 && numbered[0]!.trim() === '')) {
    const rows = finish(numbered);
    if (rows.length > 1) return rows;
  }

  // 3. Semicolons.
  if (text.includes(';')) {
    const rows = finish(text.split(';'));
    if (rows.length > 1) return rows;
  }

  // 4. Bullet characters.
  if (BULLET_SPLIT.test(text)) {
    const rows = finish(text.split(BULLET_SPLIT));
    if (rows.length > 1) return rows;
  }

  // 5. Dash bullets, whitespace-delimited only.
  if (DASH_SPLIT.test(text)) {
    const rows = finish(text.split(DASH_SPLIT));
    if (rows.length > 1) return rows;
  }

  // 6. One goal.
  return finish([text]);
}
