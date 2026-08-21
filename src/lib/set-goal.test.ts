import { describe, expect, it, vi } from 'vitest';
import { JiraError } from './jira';
import {
  createSprint,
  isValidSprintName,
  listSprints,
  MAX_SPRINT_NAME,
  nextSprintName,
  setSprintGoal,
} from './sprints';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

interface Call {
  url: string;
  method: string;
  body: string | null;
}

/**
 * A fake Jira that answers the board's sprint listing from `values` and records
 * every request. As with the close-sprint suite, `writes()` staying empty is
 * what the guard tests are actually asserting: a refusal must never reach
 * Jira's write endpoint.
 */
function fakeJira(values: unknown[], writeResponse?: () => Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({
      url: String(input),
      method,
      body: typeof init?.body === 'string' ? init.body : null,
    });

    if (method === 'POST') {
      return (
        writeResponse?.() ??
        new Response(
          JSON.stringify({ id: 43, name: 'REX Sprint 33', state: 'future', goal: 'planned' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      );
    }

    return new Response(JSON.stringify({ values, isLast: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls,
    writes: () => calls.filter((call) => call.method === 'POST'),
  };
}

const active = { id: 42, name: 'REX Sprint 32', state: 'active', goal: 'ship it' };
const closed = { id: 41, name: 'REX Sprint 31', state: 'closed', goal: 'shipped' };
const future = { id: 43, name: 'REX Sprint 33', state: 'future', goal: '' };

describe('setSprintGoal — guards', () => {
  it('refuses a sprint that is not on the board, without writing', async () => {
    const jira = fakeJira([active, closed, future]);

    const result = await setSprintGoal(config, 66, 999, 'new goal', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-on-board');
    expect(jira.writes()).toHaveLength(0);
  });

  it('refuses the ACTIVE sprint, without writing', async () => {
    // The sprint the team is working right now. Jira would allow this write;
    // the app does not, because the Plan tab plans the *next* sprint.
    const jira = fakeJira([active, future]);

    const result = await setSprintGoal(config, 66, 42, 'new goal', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-future');
    expect(result.state).toBe('active');
    expect(result.message).toContain('already running');
    expect(jira.writes()).toHaveLength(0);
  });

  it('refuses a closed sprint, without writing', async () => {
    // Jira permits editing a closed sprint's goal ("For closed sprints, only
    // the name and goal can be updated"). Rewriting a sprint already written up
    // in a retro is never the intent here, so the app refuses first.
    const jira = fakeJira([active, closed, future]);

    const result = await setSprintGoal(config, 66, 41, 'new goal', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-future');
    expect(result.state).toBe('closed');
    expect(jira.writes()).toHaveLength(0);
  });

  it('reads the board listing before deciding, never trusting the caller', async () => {
    const jira = fakeJira([future]);

    await setSprintGoal(config, 66, 43, 'new goal', { fetchImpl: jira.fetchImpl });

    expect(jira.calls[0]!.method).toBe('GET');
    expect(jira.calls[0]!.url).toContain('/rest/agile/1.0/board/66/sprint');
  });

  it('does not accept a sprint from another team’s board', async () => {
    // Board 167's listing does not contain board 66's future sprint, so asking
    // to write it while claiming the other team is refused as not-on-board.
    const jira = fakeJira([{ id: 900, name: 'SKIL Sprint 30', state: 'future', goal: '' }]);

    const result = await setSprintGoal(config, 167, 43, 'new goal', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(false);
    expect(jira.writes()).toHaveLength(0);
  });
});

describe('setSprintGoal — the write', () => {
  it('POSTs {goal} alone to the sprint endpoint', async () => {
    const jira = fakeJira([active, future]);

    const result = await setSprintGoal(config, 66, 43, 'Ship it\n\nBAU\n- [ ] RFP', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(true);
    const writes = jira.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toBe('https://example.atlassian.net/rest/agile/1.0/sprint/43');
    // Partial update: only `goal` is sent, so name, dates and state survive.
    // A PUT would null every field the body omits — which is why this is POST.
    expect(JSON.parse(writes[0]!.body!)).toEqual({ goal: 'Ship it\n\nBAU\n- [ ] RFP' });
  });

  it('sends the goal text byte for byte, newlines included', async () => {
    const jira = fakeJira([future]);
    const goal = 'a\nb\n\nBAU\n- [ ] x';

    await setSprintGoal(config, 66, 43, goal, { fetchImpl: jira.fetchImpl });

    expect(JSON.parse(jira.writes()[0]!.body!).goal).toBe(goal);
  });

  it('returns the sprint Jira echoes back', async () => {
    const jira = fakeJira([future]);

    const result = await setSprintGoal(config, 66, 43, 'planned', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sprint).toMatchObject({ id: 43, state: 'future', goal: 'planned' });
  });

  it('falls back to a locally-updated copy when the echo is unusable', async () => {
    const jira = fakeJira([future], () =>
      new Response(JSON.stringify({ nonsense: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await setSprintGoal(config, 66, 43, 'planned', {
      fetchImpl: jira.fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sprint).toMatchObject({ id: 43, goal: 'planned' });
  });

  it('surfaces a 403 — the "Manage sprints" case', async () => {
    const jira = fakeJira([future], () =>
      new Response(JSON.stringify({ errorMessages: ['You do not have permission'] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      setSprintGoal(config, 66, 43, 'planned', { fetchImpl: jira.fetchImpl }),
    ).rejects.toMatchObject({ name: 'JiraError', kind: 'forbidden' });
  });

  it('surfaces a 401 as unauthorized', async () => {
    const jira = fakeJira([future], () => new Response('{}', { status: 401 }));

    await expect(
      setSprintGoal(config, 66, 43, 'planned', { fetchImpl: jira.fetchImpl }),
    ).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('does not retry a rate-limited write', async () => {
    const jira = fakeJira([future], () =>
      new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }),
    );

    await expect(
      setSprintGoal(config, 66, 43, 'planned', { fetchImpl: jira.fetchImpl }),
    ).rejects.toBeInstanceOf(JiraError);
    expect(jira.writes()).toHaveLength(1);
  });
});

describe('createSprint', () => {
  it('POSTs {name, originBoardId} — the spec’s two required fields', async () => {
    const jira = fakeJira([active]);

    await createSprint(config, 66, 'REX Sprint 33', { fetchImpl: jira.fetchImpl });

    const writes = jira.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toBe('https://example.atlassian.net/rest/agile/1.0/sprint');
    // No dates: the spec makes them optional, and notes that a UI-started
    // sprint ignores the endDate set this way anyway.
    expect(JSON.parse(writes[0]!.body!)).toEqual({
      name: 'REX Sprint 33',
      originBoardId: 66,
    });
  });

  it('trims the name, as Jira itself does', async () => {
    const jira = fakeJira([]);

    await createSprint(config, 66, '  REX Sprint 33  ', { fetchImpl: jira.fetchImpl });

    expect(JSON.parse(jira.writes()[0]!.body!).name).toBe('REX Sprint 33');
  });

  it('returns the created future sprint', async () => {
    const jira = fakeJira([]);

    const sprint = await createSprint(config, 66, 'REX Sprint 33', {
      fetchImpl: jira.fetchImpl,
    });

    expect(sprint).toMatchObject({ id: 43, name: 'REX Sprint 33', state: 'future' });
  });

  it('reports the sprint even when the echo is unreadable', async () => {
    const jira = fakeJira([], () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const sprint = await createSprint(config, 66, 'REX Sprint 33', {
      fetchImpl: jira.fetchImpl,
    });

    // The sprint exists in Jira regardless; the caller refetches the list.
    expect(sprint).toMatchObject({ name: 'REX Sprint 33', state: 'future' });
  });

  it('surfaces a 403 rather than swallowing it', async () => {
    const jira = fakeJira([], () => new Response('{}', { status: 403 }));

    await expect(
      createSprint(config, 66, 'REX Sprint 33', { fetchImpl: jira.fetchImpl }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });
});

describe('isValidSprintName', () => {
  it.each([['REX Sprint 33'], ['a'], ['  padded  ']])('accepts %p', (name) => {
    expect(isValidSprintName(name)).toBe(true);
  });

  it.each([[''], ['   '], ['\n\t '], [null], [undefined], [42], [{}], [['a']]])(
    'rejects %p',
    (name) => {
      expect(isValidSprintName(name)).toBe(false);
    },
  );

  it('enforces Jira’s real 30-character ceiling', () => {
    // Not in the OpenAPI spec — the schema has no maxLength — but the live API
    // answers 400 "Sprint name must be shorter than 30 characters." So 29 is
    // the most that is accepted, and the check happens before the round trip.
    expect(MAX_SPRINT_NAME).toBe(29);
    expect(isValidSprintName('x'.repeat(29))).toBe(true);
    expect(isValidSprintName('x'.repeat(30))).toBe(false);
    // Trimmed before measuring, as Jira trims too.
    expect(isValidSprintName(`  ${'x'.repeat(29)}  `)).toBe(true);
  });

  it('accepts the real board series names', () => {
    for (const name of ['REX Sprint 33', 'SL Sprint 14', 'SKIL Sprint 32']) {
      expect(isValidSprintName(name), name).toBe(true);
    }
  });
});

describe('nextSprintName', () => {
  it.each([
    ['REX Sprint 32', 'REX Sprint 33'],
    ['SKIL Sprint 9', 'SKIL Sprint 10'],
    ['Marketing Sprint 31', 'Marketing Sprint 32'],
    ['Sprint 99', 'Sprint 100'],
    ['32', '33'],
  ])('increments %p to %p', (from, to) => {
    expect(nextSprintName(from)).toBe(to);
  });

  it('keeps zero padding by width', () => {
    expect(nextSprintName('Sprint 09')).toBe('Sprint 10');
    expect(nextSprintName('Sprint 099')).toBe('Sprint 100');
    // Widening is allowed; the number never loses a digit.
    expect(nextSprintName('Sprint 99')).toBe('Sprint 100');
  });

  it('leaves the prefix and its spacing verbatim', () => {
    expect(nextSprintName('REX  Sprint  32')).toBe('REX  Sprint  33');
  });

  it.each([['Final push'], [''], ['   '], [null], [undefined]])(
    'returns "" for %p, so the UI asks instead of inventing a series',
    (name) => {
      expect(nextSprintName(name as unknown as string)).toBe('');
    },
  );
});

describe('listSprints — future sprints', () => {
  const page = (values: unknown[]) =>
    vi.fn(async () =>
      new Response(JSON.stringify({ values, isLast: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

  it('returns future sprints separately, never in the retro picker', async () => {
    const list = await listSprints(config, 66, {
      fetchImpl: page([closed, active, future]),
    });

    expect(list.future.map((s) => s.id)).toEqual([43]);
    // The existing contract is untouched: active first, then closed.
    expect(list.sprints.map((s) => s.id)).toEqual([42, 41]);
    expect(list.defaultSprintId).toBe(42);
  });

  it('suggests from the furthest-ahead name available', async () => {
    const list = await listSprints(config, 66, {
      fetchImpl: page([closed, active, future]),
    });

    expect(list.latestName).toBe('REX Sprint 33');
    expect(nextSprintName(list.latestName)).toBe('REX Sprint 34');
  });

  it('falls back to the active sprint’s name when there is no future one', async () => {
    const list = await listSprints(config, 66, { fetchImpl: page([closed, active]) });

    expect(list.future).toEqual([]);
    expect(list.latestName).toBe('REX Sprint 32');
    expect(nextSprintName(list.latestName)).toBe('REX Sprint 33');
  });

  it('falls back to the newest closed sprint on a board with nothing running', async () => {
    const list = await listSprints(config, 66, { fetchImpl: page([closed]) });

    expect(list.latestName).toBe('REX Sprint 31');
  });

  it('asks Jira for all three states in one listing call', async () => {
    const fetchImpl = page([active]);
    await listSprints(config, 66, { fetchImpl });

    const url = String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0]);
    expect(url).toContain('state=active%2Cclosed%2Cfuture');
  });

  it('is empty-safe on a board with no sprints at all', async () => {
    const list = await listSprints(config, 66, { fetchImpl: page([]) });

    expect(list).toMatchObject({
      active: null,
      closed: [],
      future: [],
      sprints: [],
      defaultSprintId: null,
      latestName: null,
    });
  });
});
