import { describe, expect, it } from 'vitest';
// `?raw` keeps the fixture a real, byte-exact file on disk (diffable, and
// impossible to "fix" by editing an escaped string literal) without pulling
// Node's fs types into a project that otherwise only targets the Worker.
import sampleLetter from './__fixtures__/rex-retro-31.txt?raw';
import {
  buildMailto,
  buildTitle,
  escapeHtml,
  formatHtml,
  formatPlain,
  formatUnfinishedGoals,
  newGoal,
  newGoalId,
  nextStatus,
  normalizeStatus,
  normalizeStatusPosition,
  STATUS_ORDER,
  withGoalIds,
  type Goal,
  type RetroState,
} from './format';

/**
 * The boss's real letter, verbatim. The file carries a trailing newline because
 * text files should; `formatPlain` does not emit one, so exactly one is
 * stripped here. Everything else must match byte for byte, curly quotes
 * included.
 */
const SAMPLE = sampleLetter.replace(/\n$/, '');

/** The form state that must render exactly the sample letter. */
const sampleState: RetroState = {
  title: 'Rex Retro #31',
  goals: [
    { text: 'Investor FUP', status: 'done' },
    { text: 'K/O money flow USA chart', status: 'wip' },
    { text: 'July Metrics', status: 'done' },
    { text: 'Kenny (how to demo value)', status: 'wip' },
    { text: 'How to solve sales in Australia', status: 'wip' },
  ],
  committed: '7',
  completed: '6',
  comments: [
    'We need Cash contributions from our partners',
    'July Metric has dropped to 67% from our target of 80%',
    'JM still away',
    'Sales is an issue',
    'Investor said no, but no good reason given',
    'Great feedback from Amanda re: Rex need and solution fit',
  ].join('\n'),
  pluses: ['July leak figured out (mostly)', 'Made progress “6” completion'].join('\n'),
  improvements: 'Cut back Lux time on this until we get paid',
};

const full = sampleState;

describe('formatPlain', () => {
  it('reproduces the real letter byte for byte', () => {
    expect(formatPlain(sampleState)).toBe(SAMPLE);
  });

  it('puts the "Goals" label directly under the title with no blank line', () => {
    const out = formatPlain(sampleState).split('\n');
    expect(out[0]).toBe('Rex Retro #31');
    expect(out[1]).toBe('Goals');
  });

  it('appends the status token after the goal text by default', () => {
    expect(formatPlain(sampleState)).toContain('Investor FUP DONE');
  });

  it('renders the third state as "NOT DONE"', () => {
    const out = formatPlain({
      ...sampleState,
      goals: [{ text: 'Never started', status: 'not-done' }],
    });
    expect(out).toContain('Never started NOT DONE');
  });

  it('puts the status before the text when the setting says so', () => {
    const out = formatPlain({ ...sampleState, statusPosition: 'before' });
    expect(out).toContain('DONE Investor FUP');
    expect(out).toContain('WIP K/O money flow USA chart');
    expect(out).not.toContain('Investor FUP DONE');
  });

  it('puts a NOT DONE token before the text too', () => {
    const out = formatPlain({
      ...sampleState,
      statusPosition: 'before',
      goals: [{ text: 'Never started', status: 'not-done' }],
    });
    expect(out).toContain('NOT DONE Never started');
  });

  it('treats an unknown status position as "after"', () => {
    const out = formatPlain({
      ...sampleState,
      statusPosition: 'sideways' as never,
    });
    expect(out).toContain('Investor FUP DONE');
  });

  it('drops the Goals label entirely when there are no goals', () => {
    const out = formatPlain({ ...sampleState, goals: [] });
    expect(out).not.toContain('Goals');
    expect(out.split('\n')[0]).toBe('Rex Retro #31');
  });

  it('drops empty goal rows and trims goal text', () => {
    const out = formatPlain({
      ...sampleState,
      goals: [
        { text: '  Kept  ', status: 'done' },
        { text: '   ', status: 'wip' },
      ],
    });
    expect(out).toContain('Kept DONE');
    expect(out).not.toContain('WIP');
  });

  it('omits sections whose textarea is empty, blank line and all', () => {
    const out = formatPlain({ ...sampleState, pluses: '', improvements: '   \n  ' });
    expect(out).toContain('Comments');
    expect(out).not.toContain('Pluses');
    expect(out).not.toContain('Improvements');
    expect(out.endsWith('Great feedback from Amanda re: Rex need and solution fit')).toBe(true);
  });

  it('drops blank lines inside a section', () => {
    const out = formatPlain({
      ...sampleState,
      comments: 'One\n\n  \nTwo',
      pluses: '',
      improvements: '',
    });
    expect(out.endsWith('Comments\nOne\nTwo')).toBe(true);
  });

  it('omits both points lines when the numbers are blank', () => {
    const out = formatPlain({ ...sampleState, completed: '', committed: '' });
    expect(out).not.toContain('Commitment');
    expect(out).not.toContain('Complete');
  });

  it('keeps whichever points line is filled in, on its own', () => {
    const only = formatPlain({
      ...sampleState,
      completed: '',
      comments: '',
      pluses: '',
      improvements: '',
    });
    expect(only).toContain('Commitment 7');
    expect(only).not.toContain('Complete');

    const other = formatPlain({
      ...sampleState,
      committed: '',
      comments: '',
      pluses: '',
      improvements: '',
    });
    expect(other).toContain('Complete 6');
    expect(other).not.toContain('Commitment');
  });

  it('orders Commitment before Complete, as the sample does', () => {
    const out = formatPlain(sampleState);
    expect(out.indexOf('Commitment 7')).toBeLessThan(out.indexOf('Complete 6'));
  });

  it('returns an empty string for an empty form', () => {
    expect(
      formatPlain({
        title: '',
        goals: [],
        completed: '',
        committed: '',
        comments: '',
        pluses: '',
        improvements: '',
      }),
    ).toBe('');
  });

  it('never leaves three consecutive newlines between blocks', () => {
    expect(formatPlain(sampleState)).not.toMatch(/\n{3}/);
  });

  it('reads a legacy draft with only done/wip statuses', () => {
    // Drafts written before the third state existed carry the same two strings,
    // so they must render unchanged rather than falling back to a default.
    const legacy = JSON.parse(
      '{"goals":[{"text":"Old done","status":"done"},{"text":"Old wip","status":"wip"}]}',
    ) as { goals: Goal[] };
    const out = formatPlain({ ...sampleState, goals: legacy.goals });
    expect(out).toContain('Old done DONE');
    expect(out).toContain('Old wip WIP');
  });

  it('falls back to WIP for a status it does not recognise', () => {
    const out = formatPlain({
      ...sampleState,
      goals: [{ text: 'Mystery', status: 'blocked' as never }],
    });
    expect(out).toContain('Mystery WIP');
  });
});

describe('status helpers', () => {
  it('cycles done -> wip -> not done -> done', () => {
    expect(nextStatus('done')).toBe('wip');
    expect(nextStatus('wip')).toBe('not-done');
    expect(nextStatus('not-done')).toBe('done');
  });

  it('cycles back to the start after one full lap', () => {
    let status = STATUS_ORDER[0]!;
    for (let i = 0; i < STATUS_ORDER.length; i += 1) status = nextStatus(status);
    expect(status).toBe(STATUS_ORDER[0]);
  });

  it('normalizes the statuses that old and hand-edited drafts contain', () => {
    expect(normalizeStatus('done')).toBe('done');
    expect(normalizeStatus('DONE')).toBe('done');
    expect(normalizeStatus('wip')).toBe('wip');
    expect(normalizeStatus('not-done')).toBe('not-done');
    expect(normalizeStatus('not done')).toBe('not-done');
    expect(normalizeStatus('NOT DONE')).toBe('not-done');
    expect(normalizeStatus(undefined)).toBe('wip');
    expect(normalizeStatus(null)).toBe('wip');
    expect(normalizeStatus(42)).toBe('wip');
  });

  it('normalizes the status position, defaulting to after', () => {
    expect(normalizeStatusPosition('before')).toBe('before');
    expect(normalizeStatusPosition('after')).toBe('after');
    expect(normalizeStatusPosition(undefined)).toBe('after');
    expect(normalizeStatusPosition('nonsense')).toBe('after');
  });
});

describe('goal ids', () => {
  it('mints a unique id for every new goal', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newGoal('x').id));
    expect(ids.size).toBe(500);
    expect([...ids].every((id) => typeof id === 'string' && id !== '')).toBe(true);
  });

  it('gives a new goal the neutral status by default', () => {
    expect(newGoal('Ship it').status).toBe('wip');
    expect(newGoal('Ship it', 'done').status).toBe('done');
    expect(newGoal('Ship it').text).toBe('Ship it');
  });

  it('mints ids for an old draft that has none, keeping text and status', () => {
    // Exactly the shape a draft written before ids existed carries.
    const migrated = withGoalIds([
      { text: 'Investor FUP', status: 'done' },
      { text: 'K/O money flow', status: 'wip' },
    ]);
    expect(migrated).toHaveLength(2);
    expect(migrated.map((goal) => goal.text)).toEqual(['Investor FUP', 'K/O money flow']);
    expect(migrated.map((goal) => goal.status)).toEqual(['done', 'wip']);
    expect(migrated.every((goal) => typeof goal.id === 'string' && goal.id !== '')).toBe(true);
    expect(new Set(migrated.map((goal) => goal.id)).size).toBe(2);
  });

  it('keeps ids a draft already has', () => {
    const migrated = withGoalIds([
      { text: 'a', status: 'done', id: 'keep-me' },
      { text: 'b', status: 'wip', id: 'keep-me-too' },
    ]);
    expect(migrated.map((goal) => goal.id)).toEqual(['keep-me', 'keep-me-too']);
  });

  it('replaces duplicate ids, which would defeat the point of keying by them', () => {
    const migrated = withGoalIds([
      { text: 'a', status: 'wip', id: 'same' },
      { text: 'b', status: 'wip', id: 'same' },
    ]);
    expect(migrated[0]!.id).toBe('same');
    expect(migrated[1]!.id).not.toBe('same');
    expect(migrated.map((goal) => goal.text)).toEqual(['a', 'b']);
  });

  it('normalizes statuses while migrating, like the old draft loader did', () => {
    const migrated = withGoalIds([
      { text: 'a', status: 'NOT DONE' },
      { text: 'b', status: 'nonsense' },
      { text: 'c' },
    ]);
    expect(migrated.map((goal) => goal.status)).toEqual(['not-done', 'wip', 'wip']);
  });

  it('never throws on a malformed draft, and drops only what it cannot use', () => {
    // A hand-edited or truncated localStorage blob must not lose the retro.
    const migrated = withGoalIds([
      null,
      undefined,
      'a bare string',
      42,
      { status: 'done' }, // no text
      { text: 'survivor', status: 'done' },
    ]);
    expect(migrated).toHaveLength(1);
    expect(migrated[0]!.text).toBe('survivor');
    expect(migrated[0]!.status).toBe('done');
  });

  it('returns an empty list for anything that is not an array', () => {
    expect(withGoalIds(undefined)).toEqual([]);
    expect(withGoalIds(null)).toEqual([]);
    expect(withGoalIds('goals')).toEqual([]);
    expect(withGoalIds({ text: 'a' })).toEqual([]);
  });

  it('keeps an empty-text row, because a blank added row is a real row', () => {
    expect(withGoalIds([{ text: '', status: 'wip' }])).toHaveLength(1);
  });

  it('does not let an id change the formatted output', () => {
    // The whole point of the id being optional: format is text and status only.
    const withIds: RetroState = {
      ...sampleState,
      goals: sampleState.goals.map((goal) => ({ ...goal, id: newGoalId() })),
    };
    expect(formatPlain(withIds)).toBe(formatPlain(sampleState));
    expect(formatHtml(withIds)).toBe(formatHtml(sampleState));
  });
});

describe('formatHtml', () => {
  it('carries the same lines as the plain output, in the same order', () => {
    const html = formatHtml(sampleState);
    const plainLines = formatPlain(sampleState).split('\n');

    let cursor = 0;
    for (const line of plainLines) {
      if (line === '') continue;
      const index = html.indexOf(escapeHtml(line), cursor);
      expect(index, `missing or out of order: ${line}`).toBeGreaterThan(-1);
      cursor = index;
    }
  });

  it('renders every blank line as an explicit empty element', () => {
    // Mail clients strip styles, so a margin-based blank line vanishes on
    // paste. Real elements are the only kind Apple Mail keeps.
    const html = formatHtml(sampleState);
    const blanks = html.match(/<div><br><\/div>/g) ?? [];
    const plainBlanks = formatPlain(sampleState)
      .split('\n')
      .filter((line) => line === '');
    expect(blanks).toHaveLength(plainBlanks.length);
    expect(blanks.length).toBe(4);
  });

  it('does not rely on CSS margins to separate the sections', () => {
    const html = formatHtml(sampleState);
    expect(html).not.toMatch(/margin/i);
  });

  it('never nests a block element inside a paragraph', () => {
    // `<div>` inside `<p>` is invalid: a parser closes the paragraph early and
    // the rest of the block escapes it, which reorders the pasted retro.
    // Walk the tag stack and assert nothing block-level opens inside a <p>.
    const html = formatHtml(sampleState);
    const stack: string[] = [];

    for (const [, closing, name] of html.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
      if (name === 'br') continue;
      if (closing === '/') {
        expect(stack.pop()).toBe(name);
        continue;
      }
      if (stack.includes('p')) {
        expect(['strong', 'em', 'span', 'a', 'b', 'i']).toContain(name);
      }
      stack.push(name!);
    }

    expect(stack).toEqual([]);
  });

  it('escapes HTML-special characters in user text', () => {
    const html = formatHtml({
      ...sampleState,
      goals: [{ text: 'Ship <script>alert(1)</script> & more', status: 'done' }],
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; more');
    expect(html).not.toContain('<script>');
  });

  it('honours the status position setting like the plain output', () => {
    expect(formatHtml({ ...sampleState, statusPosition: 'before' })).toContain(
      '<div>DONE Investor FUP</div>',
    );
    expect(formatHtml({ ...sampleState, statusPosition: 'after' })).toContain(
      '<div>Investor FUP DONE</div>',
    );
  });

  it('omits empty sections like the plain output does', () => {
    const html = formatHtml({ ...sampleState, pluses: '', improvements: '' });
    expect(html).not.toContain('Pluses');
    expect(html).not.toContain('Improvements');
  });

  it('is empty of content for an empty form', () => {
    const html = formatHtml({
      title: '',
      goals: [],
      completed: '',
      committed: '',
      comments: '',
      pluses: '',
      improvements: '',
    });
    expect(html).not.toContain('<br>');
  });
});

describe('formatUnfinishedGoals', () => {
  it('keeps wip and not-done, drops done, and writes no status tokens', () => {
    const goals: Goal[] = [
      { text: 'Investor FUP', status: 'done' },
      { text: 'K/O money flow USA chart', status: 'wip' },
      { text: 'July Metrics', status: 'done' },
      { text: 'How to solve sales in Australia', status: 'not-done' },
    ];
    expect(formatUnfinishedGoals(goals)).toBe(
      'K/O money flow USA chart\nHow to solve sales in Australia',
    );
  });

  it('returns nothing when every goal is done', () => {
    const goals: Goal[] = [
      { text: 'Investor FUP', status: 'done' },
      { text: 'July Metrics', status: 'done' },
    ];
    expect(formatUnfinishedGoals(goals)).toBe('');
  });

  it('skips goals with empty or whitespace-only text', () => {
    const goals: Goal[] = [
      { text: '   ', status: 'wip' },
      { text: '', status: 'not-done' },
      { text: '  Kenny (how to demo value)  ', status: 'wip' },
    ];
    expect(formatUnfinishedGoals(goals)).toBe('Kenny (how to demo value)');
  });

  it('preserves the order of the goal list', () => {
    const goals: Goal[] = [
      { text: 'third', status: 'not-done' },
      { text: 'first', status: 'wip' },
      { text: 'done one', status: 'done' },
      { text: 'second', status: 'wip' },
    ];
    expect(formatUnfinishedGoals(goals)).toBe('third\nfirst\nsecond');
  });

  it('is unaffected by the status position setting, having no tokens to place', () => {
    const goals: Goal[] = [{ text: 'K/O money flow USA chart', status: 'wip' }];
    expect(formatUnfinishedGoals(goals)).toBe('K/O money flow USA chart');
    expect(formatUnfinishedGoals(goals)).not.toContain('WIP');
  });

  it('treats an unrecognised status as unfinished, matching normalizeStatus', () => {
    const goals = [{ text: 'mystery', status: 'sideways' as unknown }] as Goal[];
    expect(formatUnfinishedGoals(goals)).toBe('mystery');
  });

  it('handles an empty or missing goal list', () => {
    expect(formatUnfinishedGoals([])).toBe('');
    expect(formatUnfinishedGoals(undefined as unknown as Goal[])).toBe('');
  });

  it('ignores goal ids, like every other formatter here', () => {
    expect(formatUnfinishedGoals([newGoal('carry me', 'wip')])).toBe('carry me');
  });
});

describe('buildTitle', () => {
  it('substitutes the sprint number into the team template', () => {
    expect(buildTitle('Rex Retro #{sprint}', '31')).toBe('Rex Retro #31');
  });

  it('trims the sprint value', () => {
    expect(buildTitle('Marketing Retro #{sprint}', '  7 ')).toBe('Marketing Retro #7');
  });

  it('leaves the placeholder empty when no sprint is set', () => {
    expect(buildTitle('Rex Retro #{sprint}', '')).toBe('Rex Retro #');
  });
});

describe('buildMailto', () => {
  it('joins recipients with commas and keeps @ readable', () => {
    const url = buildMailto(['a@example.com', 'b@example.com'], 'Subject', 'Body');
    expect(url.startsWith('mailto:a@example.com,b@example.com?')).toBe(true);
  });

  it('drops blank recipients', () => {
    const url = buildMailto(['  ', 'a@example.com', ''], 'S', 'B');
    expect(url.startsWith('mailto:a@example.com?')).toBe(true);
  });

  it('supports an empty recipient list', () => {
    expect(buildMailto([], 'S', 'B').startsWith('mailto:?')).toBe(true);
  });

  it('encodes spaces as %20 rather than +', () => {
    const url = buildMailto([], 'Rex Retro', 'line one\nline two');
    expect(url).toContain('subject=Rex%20Retro');
    expect(url).not.toContain('+');
  });

  it('round-trips the body through URL parsing', () => {
    const body = formatPlain(full);
    const url = buildMailto(['a@example.com'], full.title, body);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('body')).toBe(body);
    expect(parsed.searchParams.get('subject')).toBe(full.title);
  });

  it('carries the status position through into the mail body', () => {
    const body = formatPlain({ ...full, statusPosition: 'before' });
    const parsed = new URL(buildMailto(['a@example.com'], full.title, body));
    expect(parsed.searchParams.get('body')).toContain('DONE Investor FUP');
  });
});
