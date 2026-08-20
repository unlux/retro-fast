/**
 * Forgiving goal splitter.
 *
 * Jira's sprint `goal` field is a single-line plain-text blob (multiline is an
 * unfulfilled feature request), so people delimit multiple goals however they
 * feel like on the day. The same splitter backs the paste-box in the manual
 * form, where pasted text usually does have newlines.
 *
 * Strategy, first match wins:
 *   1. Newlines, if the text contains any.
 *   2. Numbered list markers ("1. ", "2)", "(3)") — checked before the other
 *      single-line delimiters because "1. Ship X - the new one; 2. Fix Y"
 *      should split into two goals, not four.
 *   3. Semicolons.
 *   4. Bullet characters: • ▪ ‣ ◦ *
 *   5. Dash bullets (" - ", " – ", " — ") — only with surrounding whitespace,
 *      so hyphenated words and "A-B testing" survive.
 *   6. Otherwise the whole string is one goal.
 *
 * Rows stay editable in the UI, so a bad split costs one manual fix.
 */

/** Leading list/bullet decoration to strip off an individual row. */
const LEADING_MARKER = /^\s*(?:[-–—*•▪‣◦]+|\(?\d+[.)]|\d+\s*[.)])\s*/;

/** A numbered marker anywhere in a single-line blob, e.g. "2." or "(3)". */
const NUMBERED_SPLIT = /(?:^|\s)\(?\d+[.)]\s*/;

const BULLET_SPLIT = /[•▪‣◦*]+/;

const DASH_SPLIT = /\s+[-–—]+\s+/;

function clean(row: string): string {
  return row.replace(LEADING_MARKER, '').trim();
}

function finish(rows: string[]): string[] {
  return rows.map(clean).filter((row) => row.length > 0);
}

/**
 * Split a blob of goal text into individual goal rows.
 * Always returns trimmed, non-empty rows; returns `[]` for blank input.
 */
export function splitGoals(input: string): string[] {
  if (typeof input !== 'string') return [];

  const text = input.trim();
  if (text === '') return [];

  // 1. Newlines win whenever they exist.
  if (/\r|\n/.test(text)) {
    return finish(text.split(/\r\n|\r|\n/));
  }

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
