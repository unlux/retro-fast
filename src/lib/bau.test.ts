import { describe, expect, it } from 'vitest';
import bauLetter from './__fixtures__/rex-retro-32-bau.txt?raw';
import {
  bauBlockLines,
  bauKey,
  bauLine,
  mergeBauParse,
  newBauItem,
  normalizeBauChecks,
  normalizeBauItems,
  splitBauBlock,
  type BauItem,
} from './bau';
import { formatHtml, formatPlain, type RetroState } from './format';
import { splitGoals } from './split-goals';

/**
 * The boss's BAU section exactly as he typed it into the letter, sloppy spacing
 * and all. Every parse test that matters runs against this string rather than a
 * tidied-up version of it, because the tidied-up version is not what arrives.
 */
const BOSS_BLOCK = `BAU
- [] RFP
- []Marketing Video
- [] linkedin post.`;

const items = (...texts: string[]): BauItem[] =>
  texts.map((text, index) => ({ id: `i${index}`, text }));

describe('splitBauBlock — the boss’s own format', () => {
  it('parses the block verbatim, sloppy spacing included', () => {
    const { bau, rest } = splitBauBlock(`Ship the thing\nFix the other\n${BOSS_BLOCK}`);

    expect(bau).not.toBeNull();
    // "- []Marketing Video" has no space after the brackets and must not lose
    // its first letter; "- [] RFP" has no space inside them.
    expect(bau!.items).toEqual(['RFP', 'Marketing Video', 'linkedin post.']);
    // Nothing is ticked in the boss's sample: every box is empty.
    expect(bau!.checked).toEqual([]);
    expect(rest).toBe('Ship the thing\nFix the other');
  });

  it('reads ticks from [x] and [X]', () => {
    const { bau } = splitBauBlock('BAU\n- [x] RFP\n- [ ] Video\n- [X] Post');

    expect(bau!.items).toEqual(['RFP', 'Video', 'Post']);
    expect(bau!.checked).toEqual(['RFP', 'Post']);
  });

  it('accepts a trailing colon and any casing on the header', () => {
    for (const header of ['BAU', 'bau', 'Bau', 'BAU:', 'bau :']) {
      const { bau } = splitBauBlock(`Goal one\n${header}\n- [ ] Item`);
      expect(bau, header).not.toBeNull();
      expect(bau!.items).toEqual(['Item']);
    }
  });

  it('accepts every bullet and spacing variant of a checkbox line', () => {
    const { bau } = splitBauBlock('BAU\n-[]A\n*  [ ]  B\n+ [x]C\n— [ ] D');

    expect(bau!.items).toEqual(['A', 'B', 'C', 'D']);
    expect(bau!.checked).toEqual(['C']);
  });

  it('tolerates a blank line inside the block rather than truncating it', () => {
    const { bau } = splitBauBlock('BAU\n- [ ] A\n\n- [x] B');

    expect(bau!.items).toEqual(['A', 'B']);
    expect(bau!.checked).toEqual(['B']);
  });

  it('ends the block at the first non-checkbox line and returns the rest', () => {
    const { bau, rest } = splitBauBlock('Goal one\nBAU\n- [ ] A\nGoal two\n- [ ] B');

    expect(bau!.items).toEqual(['A']);
    // "Goal two" ended the block, so the checkbox after it is ordinary text
    // again and stays in `rest` for the goal splitter.
    expect(rest).toBe('Goal one\nGoal two\n- [ ] B');
  });

  it('returns no block when there is no BAU header', () => {
    const text = 'Goal one\n- [ ] A\n- [x] B';

    expect(splitBauBlock(text)).toEqual({ rest: text, bau: null });
  });

  it('leaves a BAU header with nothing under it alone', () => {
    // A bare "BAU" line with no checkbox list is a goal line that happens to
    // read BAU, not an empty section.
    const text = 'Goal one\nBAU\nGoal two';

    expect(splitBauBlock(text)).toEqual({ rest: text, bau: null });
  });

  it('does not match the Marketing board’s "BAU (business as usual)" line', () => {
    // Pinned separately because the loose version of this match would silently
    // eat a real goal row that three fixture tests depend on.
    const text = 'Goal one\nBAU (business as usual)\n- [ ] Podcast';

    expect(splitBauBlock(text).bau).toBeNull();
  });

  it.each([['', ''], [null, ''], [undefined, '']])(
    'handles %p without throwing',
    (input, expected) => {
      expect(splitBauBlock(input as unknown as string)).toEqual({ rest: expected, bau: null });
    },
  );
});

/**
 * The regression guard the whole design turns on: the goal splitter must keep
 * stripping checkbox markers into goal rows for every checkbox line that is NOT
 * under a BAU header. That is how the Marketing board's goals arrive, and it is
 * pinned by fixture tests in split-goals.test.ts.
 */
describe('BAU parsing vs. the existing checkbox behaviour', () => {
  it('leaves checkbox goals to the splitter when no BAU header precedes them', () => {
    const marketing =
      'FBook Ads\n- [ ] Podcast\n- [ ] Video Content\n- [x] DMs';
    const { rest, bau } = splitBauBlock(marketing);

    expect(bau).toBeNull();
    expect(rest).toBe(marketing);
    // Unchanged splitter behaviour: markers stripped, each item its own row.
    expect(splitGoals(rest)).toEqual(['FBook Ads', 'Podcast', 'Video Content', 'DMs']);
  });

  it('splits the two populations apart when both appear in one goal field', () => {
    const mixed =
      'FBook Ads\n- [ ] Podcast\nBAU\n- [x] RFP\n- [] Marketing Video';
    const { rest, bau } = splitBauBlock(mixed);

    // Under the header: BAU items, not goals.
    expect(bau!.items).toEqual(['RFP', 'Marketing Video']);
    expect(bau!.checked).toEqual(['RFP']);
    // Above it: still goals, checkbox marker stripped as always.
    expect(splitGoals(rest)).toEqual(['FBook Ads', 'Podcast']);
  });

  it('keeps the Marketing "BAU (business as usual)" line as a goal row', () => {
    const text =
      'RFP leads K/O\nBAU (business as usual)\n- [ ] Podcast\n- [ ] DMs';
    const { rest, bau } = splitBauBlock(text);

    expect(bau).toBeNull();
    expect(splitGoals(rest)).toEqual([
      'RFP leads K/O',
      'BAU (business as usual)',
      'Podcast',
      'DMs',
    ]);
  });
});

describe('mergeBauParse', () => {
  it('adds unknown items and keeps the existing ones', () => {
    const existing = items('RFP', 'Podcast');
    const result = mergeBauParse(existing, {
      items: ['RFP', 'Marketing Video'],
      checked: ['RFP'],
    });

    expect(result.items.map((i) => i.text)).toEqual(['RFP', 'Podcast', 'Marketing Video']);
    expect(result.added).toBe(1);
    // "Podcast" was not mentioned in this sprint's goal text and must survive:
    // a prefill never deletes from the standing list.
    expect(result.items.map((i) => i.id).slice(0, 2)).toEqual(['i0', 'i1']);
  });

  it('matches on trimmed, case-folded text so re-typing does not duplicate', () => {
    const existing = items('RFP', 'Marketing Video');
    const result = mergeBauParse(existing, {
      items: ['  rfp  ', 'MARKETING video'],
      checked: ['  rfp  '],
    });

    expect(result.items).toHaveLength(2);
    expect(result.added).toBe(0);
    // The existing item keeps its own text and id — a prefill is not a rename.
    expect(result.items[0]!.text).toBe('RFP');
    expect(result.checks).toEqual({ i0: true });
  });

  it('returns a fresh checks map rather than merging onto anything', () => {
    const existing = items('RFP', 'Podcast');
    const result = mergeBauParse(existing, { items: ['Podcast'], checked: [] });

    // Nothing ticked in this sprint's text means nothing ticked, full stop.
    expect(result.checks).toEqual({});
  });

  it('ticks by id, so two items with different ids never share a checkbox', () => {
    const result = mergeBauParse([], { items: ['A', 'B'], checked: ['B'] });

    const b = result.items.find((i) => i.text === 'B')!;
    expect(result.checks[b.id]).toBe(true);
    expect(Object.keys(result.checks)).toHaveLength(1);
  });

  it('ignores an empty item text', () => {
    const result = mergeBauParse([], { items: ['', '   ', 'Real'], checked: [] });

    expect(result.items.map((i) => i.text)).toEqual(['Real']);
  });
});

describe('bauBlockLines / bauLine', () => {
  it('normalizes every spelling to "- [ ] x" / "- [x] x"', () => {
    const list = items('RFP', 'Marketing Video', 'linkedin post.');
    const lines = bauBlockLines(list, { i0: true, i2: true });

    expect(lines).toEqual([
      'BAU',
      '- [x] RFP',
      '- [ ] Marketing Video',
      '- [x] linkedin post.',
    ]);
  });

  it('returns nothing at all for an empty list', () => {
    expect(bauBlockLines([], {})).toEqual([]);
    expect(bauBlockLines([{ id: 'a', text: '   ' }], {})).toEqual([]);
  });

  it('treats a missing checks entry as unchecked', () => {
    expect(bauBlockLines(items('A'), {})).toEqual(['BAU', '- [ ] A']);
    expect(bauBlockLines(items('A'))).toEqual(['BAU', '- [ ] A']);
  });

  it('trims item text into the line', () => {
    expect(bauLine('  RFP  ', false)).toBe('- [ ] RFP');
    expect(bauLine('RFP', true)).toBe('- [x] RFP');
  });
});

describe('the letter with a BAU section', () => {
  const state: RetroState = {
    title: 'Rex Retro #32',
    goals: [
      { text: 'Investor FUP', status: 'done' },
      { text: 'K/O money flow USA chart', status: 'wip' },
      { text: 'July Metrics', status: 'not-done' },
    ],
    committed: '7',
    completed: '5',
    comments: 'Sales pipeline is thin',
    pluses: 'New partner signed',
    improvements: 'Shorter standups',
    bauItems: items('RFP', 'Marketing Video', 'linkedin post.'),
    bauChecks: { i0: true, i2: true },
  };

  it('matches the fixture byte for byte', () => {
    expect(formatPlain(state)).toBe(bauLetter.replace(/\n$/, ''));
  });

  it('puts BAU last in the Goals block, before the points', () => {
    expect(formatPlain(state)).toContain(
      'July Metrics NOT DONE\nBAU\n- [x] RFP\n- [ ] Marketing Video\n- [x] linkedin post.\n\nCommitment 7',
    );
  });

  it('keeps the Goals heading when BAU is the only kind of goal', () => {
    const plain = formatPlain({ ...state, goals: [] });

    expect(plain).toContain('Rex Retro #32\n\nGoals\nBAU\n- [x] RFP');
  });

  it('omits the section entirely when the list is empty', () => {
    const plain = formatPlain({ ...state, bauItems: [], bauChecks: {} });

    expect(plain).not.toContain('BAU');
    expect(plain.endsWith('Improvements\nShorter standups')).toBe(true);
    // And with the keys absent altogether, which is what an old draft looks like.
    const { bauItems: _i, bauChecks: _c, ...without } = state;
    expect(formatPlain(without)).toBe(plain);
  });

  it('renders identically in the HTML flavour, blank-line rules included', () => {
    const html = formatHtml(state);

    expect(html).toContain(
      '<div>July Metrics NOT DONE</div><div>BAU</div><div>- [x] RFP</div>',
    );
    expect(html).toContain('<div>- [ ] Marketing Video</div>');
    expect(html).toContain(
      '<div>- [x] linkedin post.</div><div><br></div><div>Commitment 7</div>',
    );
  });

  it('carries no BAU markup when the list is empty', () => {
    expect(formatHtml({ ...state, bauItems: [] })).not.toContain('BAU');
  });
});

describe('normalizers', () => {
  it('keeps well-formed items and mints ids for the rest', () => {
    const out = normalizeBauItems([
      { id: 'keep', text: 'RFP' },
      { text: 'No id' },
      { id: 'keep', text: 'Duplicate id' },
      { id: 'x', text: '   ' },
      null,
      'nope',
      { id: 'y' },
    ]);

    expect(out.map((i) => i.text)).toEqual(['RFP', 'No id', 'Duplicate id']);
    expect(out[0]!.id).toBe('keep');
    expect(out[1]!.id).not.toBe('');
    // The repeated id is replaced: two rows sharing one id share one checkbox.
    expect(out[2]!.id).not.toBe('keep');
    expect(new Set(out.map((i) => i.id)).size).toBe(3);
  });

  it.each([[null], [undefined], ['string'], [42], [{}]])(
    'returns [] for %p',
    (value) => {
      expect(normalizeBauItems(value)).toEqual([]);
    },
  );

  it('keeps only true entries in a checks map', () => {
    expect(normalizeBauChecks({ a: true, b: false, c: 'yes', d: 1 })).toEqual({ a: true });
  });

  it.each([[null], [undefined], [[]], ['x']])('returns {} for %p', (value) => {
    expect(normalizeBauChecks(value)).toEqual({});
  });

  it('mints a unique id per new item', () => {
    expect(newBauItem('A').id).not.toBe(newBauItem('A').id);
  });

  it('folds case and whitespace in bauKey', () => {
    expect(bauKey('  RFP ')).toBe('rfp');
    expect(bauKey(null as unknown as string)).toBe('');
  });
});
