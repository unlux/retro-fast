import { describe, expect, it, vi } from 'vitest';
import { JiraError } from './jira';
import { closeSprint } from './sprints';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

interface Call {
  url: string;
  method: string;
  body: string | null;
}

/**
 * A fake Jira that answers the board's sprint listing from `values` and records
 * every request. The write endpoint is what these tests are really watching:
 * `writes()` must stay empty for every refusal, because the whole point of the
 * guard is that a rejected close never reaches Jira.
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
        new Response(JSON.stringify({ id: 42, name: 'REX Sprint 32', state: 'closed', goal: 'g' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
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
const future = { id: 43, name: 'REX Sprint 33', state: 'future', goal: 'later' };

describe('closeSprint — guards', () => {
  it('refuses a sprint that is not on the board, without calling the write endpoint', async () => {
    const jira = fakeJira([active, closed]);

    const result = await closeSprint(config, 66, 999, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-on-board');
    // The guard, not Jira, is what stopped this.
    expect(jira.writes()).toHaveLength(0);
  });

  it('refuses an already-closed sprint, without calling the write endpoint', async () => {
    const jira = fakeJira([active, closed]);

    const result = await closeSprint(config, 66, 41, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-active');
    expect(result.state).toBe('closed');
    expect(result.message).toContain('already closed');
    expect(jira.writes()).toHaveLength(0);
  });

  it('refuses a future sprint, without calling the write endpoint', async () => {
    // `state=active,closed` means a future sprint normally never appears in the
    // listing, but the guard must not depend on the query string for safety.
    const jira = fakeJira([active, future]);

    const result = await closeSprint(config, 66, 43, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-active');
    expect(result.state).toBe('future');
    expect(jira.writes()).toHaveLength(0);
  });

  it('reads the board listing before deciding, never trusting the caller', async () => {
    const jira = fakeJira([active]);

    await closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl });

    // First call is always the board's own sprint listing.
    expect(jira.calls[0]!.method).toBe('GET');
    expect(jira.calls[0]!.url).toContain('/rest/agile/1.0/board/66/sprint');
  });
});

describe('closeSprint — the write', () => {
  it('POSTs {state:"closed"} to the sprint endpoint for an active sprint', async () => {
    const jira = fakeJira([active, closed]);

    const result = await closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    const writes = jira.writes();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.url).toBe('https://example.atlassian.net/rest/agile/1.0/sprint/42');
    // Partial update: state is the entire body. Sending startDate/endDate is
    // only required for PUT (full update), which nulls omitted fields.
    expect(JSON.parse(writes[0]!.body!)).toEqual({ state: 'closed' });
  });

  it('returns the sprint Jira echoes back, now closed', async () => {
    const jira = fakeJira([active]);

    const result = await closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sprint).toMatchObject({ id: 42, state: 'closed' });
  });

  it('falls back to a locally-closed copy when Jira echoes something unusable', async () => {
    const jira = fakeJira([active], () =>
      new Response(JSON.stringify({ nonsense: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl });

    // The write succeeded; a junk response body must not report failure.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.sprint).toMatchObject({ id: 42, name: 'REX Sprint 32', state: 'closed' });
  });

  it('surfaces a 403 as a forbidden JiraError — the "Manage sprints" case', async () => {
    const jira = fakeJira([active], () =>
      new Response(JSON.stringify({ errorMessages: ['You do not have permission'] }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl })).rejects.toMatchObject({
      name: 'JiraError',
      kind: 'forbidden',
    });
  });

  it('surfaces a 401 as unauthorized so the UI can say "rotate the token"', async () => {
    const jira = fakeJira([active], () => new Response('{}', { status: 401 }));

    await expect(closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('does not retry a rate-limited write', async () => {
    // Reads retry on 429; a write must not, or a close could fire twice.
    const jira = fakeJira([active], () =>
      new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }),
    );

    await expect(closeSprint(config, 66, 42, { fetchImpl: jira.fetchImpl })).rejects.toBeInstanceOf(
      JiraError,
    );
    expect(jira.writes()).toHaveLength(1);
  });
});
