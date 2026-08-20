import { describe, expect, it } from 'vitest';
import { buildMailto, buildTitle, escapeHtml, formatHtml, formatPlain, type RetroState } from './format';

const full: RetroState = {
  title: 'Rex Retro — Sprint 42',
  goals: [
    { text: 'Goal one text', status: 'done' },
    { text: 'Goal two text', status: 'wip' },
  ],
  completed: '29',
  committed: '34',
  comments: 'First comment line\nSecond comment line',
  pluses: '...',
  improvements: '...',
};

describe('formatPlain', () => {
  it('matches the PLAN output template exactly', () => {
    const expected = [
      'Rex Retro — Sprint 42',
      '',
      'done Goal one text',
      'wip  Goal two text',
      '',
      'Completed: 29 / Committed: 34',
      '',
      'Comments',
      'First comment line',
      'Second comment line',
      '',
      'Pluses',
      '...',
      '',
      'Improvements',
      '...',
    ].join('\n');

    expect(formatPlain(full)).toBe(expected);
  });

  it('pads "wip" so goal text lines up under "done"', () => {
    const out = formatPlain({ ...full, comments: '', pluses: '', improvements: '' });
    const [doneLine, wipLine] = out.split('\n').filter((l) => /^(done|wip)/.test(l));
    expect(doneLine!.indexOf('Goal')).toBe(wipLine!.indexOf('Goal'));
  });

  it('drops empty goal rows and trims goal text', () => {
    const out = formatPlain({
      ...full,
      goals: [
        { text: '  Kept  ', status: 'done' },
        { text: '   ', status: 'wip' },
      ],
    });
    expect(out).toContain('done Kept');
    expect(out).not.toContain('wip ');
  });

  it('omits sections whose textarea is empty', () => {
    const out = formatPlain({ ...full, pluses: '', improvements: '   \n  ' });
    expect(out).toContain('Comments');
    expect(out).not.toContain('Pluses');
    expect(out).not.toContain('Improvements');
  });

  it('drops blank lines inside a section', () => {
    const out = formatPlain({
      ...full,
      comments: 'One\n\n  \nTwo',
      pluses: '',
      improvements: '',
    });
    expect(out.endsWith('Comments\nOne\nTwo')).toBe(true);
  });

  it('omits the points line when both numbers are blank', () => {
    const out = formatPlain({ ...full, completed: '', committed: '' });
    expect(out).not.toContain('Completed:');
  });

  it('shows an em dash for a half-filled points line', () => {
    const out = formatPlain({ ...full, completed: '29', committed: '' });
    expect(out).toContain('Completed: 29 / Committed: —');
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
    expect(formatPlain(full)).not.toMatch(/\n{3}/);
  });
});

describe('formatHtml', () => {
  it('bolds the heading and every section label', () => {
    const html = formatHtml(full);
    expect(html).toContain('<strong>Rex Retro — Sprint 42</strong>');
    expect(html).toContain('<strong>Comments</strong>');
    expect(html).toContain('<strong>Pluses</strong>');
    expect(html).toContain('<strong>Improvements</strong>');
  });

  it('bolds the done/wip status labels without the padding space', () => {
    const html = formatHtml(full);
    expect(html).toContain('<strong>done</strong> Goal one text');
    expect(html).toContain('<strong>wip</strong> Goal two text');
  });

  it('carries the same content as the plain output', () => {
    const html = formatHtml(full);
    for (const line of formatPlain(full).split('\n')) {
      const content = line.replace(/^(done|wip)\s+/, '').trim();
      if (content === '') continue;
      expect(html).toContain(escapeHtml(content));
    }
  });

  it('escapes HTML-special characters in user text', () => {
    const html = formatHtml({
      ...full,
      goals: [{ text: 'Ship <script>alert(1)</script> & more', status: 'done' }],
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp; more');
    expect(html).not.toContain('<script>');
  });

  it('omits empty sections like the plain output does', () => {
    const html = formatHtml({ ...full, pluses: '', improvements: '' });
    expect(html).not.toContain('<strong>Pluses</strong>');
    expect(html).not.toContain('<strong>Improvements</strong>');
  });

  it('never nests a block element inside a paragraph', () => {
    // `<div>` inside `<p>` is invalid: a parser closes the paragraph early and
    // the rest of the block escapes it, which reorders the pasted retro.
    // Walk the tag stack and assert nothing block-level opens inside a <p>.
    const html = formatHtml(full);
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

  it('separates goal rows and section lines with line breaks', () => {
    const html = formatHtml(full);
    expect(html).toContain('<strong>done</strong> Goal one text<br /><strong>wip</strong>');
    expect(html).toContain('<strong>Comments</strong><br />First comment line<br />Second comment line');
  });
});

describe('buildTitle', () => {
  it('substitutes the sprint number into the team template', () => {
    expect(buildTitle('Rex Retro — Sprint {sprint}', '42')).toBe('Rex Retro — Sprint 42');
  });

  it('trims the sprint value', () => {
    expect(buildTitle('Marketing Retro — Sprint {sprint}', '  7 ')).toBe(
      'Marketing Retro — Sprint 7',
    );
  });

  it('leaves the placeholder empty when no sprint is set', () => {
    expect(buildTitle('Rex Retro — Sprint {sprint}', '')).toBe('Rex Retro — Sprint ');
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
});
