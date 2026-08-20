import { describe, expect, it, vi } from 'vitest';
import { CLOSED_SPRINT_COUNT, listSprints, sprintNumber } from './sprints';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

interface PageSpec {
  values: unknown[];
  isLast?: boolean;
}

/**
 * A fake Jira that serves fixed pages and records the paging parameters it was
 * asked for. Crucially it never returns `total` — the Agile API does not always
 * send it, so the pager must not depend on it.
 */
function fakeJira(pages: PageSpec[]) {
  const seen: Array<{ startAt: string | null; state: string | null }> = [];
  const fetchImpl = vi.fn(async (input: string) => {
    const url = new URL(input);
    seen.push({
      startAt: url.searchParams.get('startAt'),
      state: url.searchParams.get('state'),
    });
    const page = pages[seen.length - 1] ?? { values: [], isLast: true };
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen };
}

const closed = (id: number, n: number) => ({
  id,
  name: `REX Sprint ${n}`,
  state: 'closed',
  goal: `goal ${n}`,
});

describe('listSprints', () => {
  it('returns the active sprint first, then closed newest-first', async () => {
    const { fetchImpl } = fakeJira([
      {
        values: [
          closed(1, 28),
          closed(2, 29),
          closed(3, 30),
          { id: 4, name: 'REX Sprint 31', state: 'active', goal: 'current goal' },
        ],
        isLast: true,
      },
    ]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(result.active?.id).toBe(4);
    expect(result.sprints.map((s) => s.id)).toEqual([4, 3, 2, 1]);
    expect(result.defaultSprintId).toBe(4);
    expect(result.sprints[0]!.goal).toBe('current goal');
  });

  it('defaults to the most recently closed sprint when none is active', async () => {
    const { fetchImpl } = fakeJira([
      { values: [closed(1, 28), closed(2, 29), closed(3, 30)], isLast: true },
    ]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(result.active).toBeNull();
    expect(result.defaultSprintId).toBe(3);
    expect(result.sprints.map((s) => s.name)).toEqual([
      'REX Sprint 30',
      'REX Sprint 29',
      'REX Sprint 28',
    ]);
  });

  it(`keeps only the ${CLOSED_SPRINT_COUNT} most recent closed sprints`, async () => {
    const values = Array.from({ length: 31 }, (_, i) => closed(i + 1, i + 1));
    const { fetchImpl } = fakeJira([{ values, isLast: true }]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(result.closed).toHaveLength(CLOSED_SPRINT_COUNT);
    expect(result.closed.map((s) => s.id)).toEqual([31, 30, 29, 28, 27]);
  });

  it('pages via isLast to reach the newest closed sprints, without using `total`', async () => {
    const first = Array.from({ length: 50 }, (_, i) => closed(i + 1, i + 1));
    const second = [closed(51, 51), closed(52, 52)];
    const { fetchImpl, seen } = fakeJira([
      { values: first, isLast: false },
      { values: second, isLast: true },
    ]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(seen.map((s) => s.startAt)).toEqual(['0', '50']);
    expect(seen[0]!.state).toBe('active,closed');
    // Newest live on the last page, which is the whole reason we page.
    expect(result.closed.map((s) => s.id)).toEqual([52, 51, 50, 49, 48]);
  });

  it('stops on an empty page even if isLast never arrives', async () => {
    const { fetchImpl, seen } = fakeJira([
      { values: [closed(1, 1)] },
      { values: [] },
    ]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(seen).toHaveLength(2);
    expect(result.closed.map((s) => s.id)).toEqual([1]);
  });

  it('skips malformed sprint entries rather than failing the whole list', async () => {
    const { fetchImpl } = fakeJira([
      {
        values: [closed(1, 1), { name: 'no id' }, null, { id: 2, state: 'closed' }],
        isLast: true,
      },
    ]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(result.closed.map((s) => s.id)).toEqual([2, 1]);
    // Missing name and goal get safe defaults.
    expect(result.closed[0]).toMatchObject({ id: 2, name: 'Sprint 2', goal: '' });
  });

  it('rejects ids that only coerce to a number by accident', async () => {
    // `Number(null)`, `Number(true)`, `Number([])` and `Number('')` are all
    // finite, so a loose coercion would invent sprints with id 0 or 1.
    const { fetchImpl } = fakeJira([
      {
        values: [
          { id: null, name: 'null id', state: 'closed' },
          { id: true, name: 'boolean id', state: 'closed' },
          { id: [], name: 'array id', state: 'closed' },
          { id: '', name: 'empty id', state: 'closed' },
          { id: '  ', name: 'blank id', state: 'closed' },
          { id: 'abc', name: 'text id', state: 'closed' },
          // Numeric strings are legitimate and must survive.
          { id: '42', name: 'REX Sprint 42', state: 'closed', goal: 'g' },
        ],
        isLast: true,
      },
    ]);

    const result = await listSprints(config, 66, { fetchImpl });

    expect(result.closed.map((s) => s.id)).toEqual([42]);
  });
});

describe('sprintNumber', () => {
  it('reads the trailing number from real sprint names', () => {
    expect(sprintNumber('REX Sprint 32')).toBe('32');
    expect(sprintNumber('SL Sprint 12')).toBe('12');
    expect(sprintNumber('SKIL Sprint 31')).toBe('31');
  });

  it('ignores leading numbers and takes the trailing one', () => {
    expect(sprintNumber('2026 Q3 Sprint 7')).toBe('7');
  });

  it('tolerates trailing whitespace', () => {
    expect(sprintNumber('REX Sprint 9  ')).toBe('9');
  });

  it('returns empty when there is no trailing number', () => {
    expect(sprintNumber('Final push')).toBe('');
    expect(sprintNumber('')).toBe('');
    // @ts-expect-error deliberately wrong type
    expect(sprintNumber(null)).toBe('');
  });
});
