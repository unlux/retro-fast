import { describe, expect, it, vi } from 'vitest';
import { JiraError, daysUntilExpiry, jiraFetch, readJiraConfig, retryAfterMs } from './jira';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

describe('readJiraConfig', () => {
  it('trims values and drops a trailing slash from the site', () => {
    expect(
      readJiraConfig({
        JIRA_SITE: 'https://example.atlassian.net/ ',
        JIRA_EMAIL: ' a@b.c ',
        JIRA_API_TOKEN: ' tok ',
      } as Env),
    ).toEqual({ site: 'https://example.atlassian.net', email: 'a@b.c', token: 'tok' });
  });

  it('throws `unconfigured` naming every missing variable', () => {
    try {
      readJiraConfig({ JIRA_SITE: 'https://x.atlassian.net' } as Env);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(JiraError);
      expect((error as JiraError).kind).toBe('unconfigured');
      expect((error as JiraError).message).toContain('JIRA_EMAIL');
      expect((error as JiraError).message).toContain('JIRA_API_TOKEN');
    }
  });

  it('treats blank strings and a missing env as unconfigured', () => {
    expect(() => readJiraConfig({ JIRA_SITE: '  ' } as Env)).toThrow(JiraError);
    expect(() => readJiraConfig(undefined)).toThrow(JiraError);
  });
});

describe('retryAfterMs', () => {
  it('reads delta-seconds', () => {
    expect(retryAfterMs('2')).toBe(2000);
  });

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-08-20T00:00:00Z');
    expect(retryAfterMs('Thu, 20 Aug 2026 00:00:03 GMT', now)).toBe(3000);
  });

  it('clamps an absurd wait', () => {
    expect(retryAfterMs('86400')).toBe(5000);
  });

  it('returns null for missing, blank, past or unparseable values', () => {
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('  ')).toBeNull();
    expect(retryAfterMs('0')).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
    const now = Date.parse('2026-08-20T00:00:00Z');
    expect(retryAfterMs('Thu, 20 Aug 2026 00:00:00 GMT', now)).toBeNull();
  });
});

describe('jiraFetch', () => {
  it('builds the URL, sends Basic auth and returns parsed JSON', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ ok: 1 }));

    const body = await jiraFetch<{ ok: number }>(config, 'rest/agile/1.0/board/66/sprint', {
      search: { state: 'active,closed', startAt: 0, skipMe: undefined },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(body).toEqual({ ok: 1 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    // `undefined` search values are dropped, not sent as "undefined".
    expect(url).toBe(
      'https://example.atlassian.net/rest/agile/1.0/board/66/sprint?state=active%2Cclosed&startAt=0',
    );
    expect(init?.headers).toMatchObject({
      Authorization: `Basic ${btoa('a@b.c:secret')}`,
      Accept: 'application/json',
    });
  });

  it('maps 401 to a distinct unauthorized error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errorMessages: ['nope'] }, { status: 401 }));

    await expect(
      jiraFetch(config, 'x', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });

    const error = await jiraFetch(config, 'x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: JiraError) => e);
    expect((error as JiraError).message).toMatch(/invalid or has expired/);
    expect((error as JiraError).httpStatus).toBe(401);
  });

  it('maps other statuses and folds in Jira errorMessages', async () => {
    const cases: Array<[number, string]> = [
      [403, 'forbidden'],
      [404, 'not-found'],
      [500, 'upstream'],
    ];

    for (const [status, kind] of cases) {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ errorMessages: ['The board does not support sprints'] }, { status }),
      );
      const error = (await jiraFetch(config, 'x', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }).catch((e: JiraError) => e)) as JiraError;

      expect(error.kind).toBe(kind);
      expect(error.message).toContain('The board does not support sprints');
    }
  });

  it('retries a 429 honoring Retry-After, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({}, { status: 429, headers: { 'Retry-After': '0' } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const body = await jiraFetch<{ ok: boolean }>(config, 'x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('gives up on a persistent 429 as rate-limited', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({}, { status: 429, headers: { 'Retry-After': '0' } }),
    );

    const error = (await jiraFetch(config, 'x', {
      maxRetries: 1,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: JiraError) => e)) as JiraError;

    expect(error.kind).toBe('rate-limited');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps a network failure and unparseable JSON to `network`', async () => {
    const boom = vi.fn(async () => {
      throw new TypeError('connection reset');
    });
    await expect(
      jiraFetch(config, 'x', { fetchImpl: boom as unknown as typeof fetch }),
    ).rejects.toMatchObject({ kind: 'network' });

    const garbage = vi.fn(async () => new Response('<html>nope', { status: 200 }));
    await expect(
      jiraFetch(config, 'x', { fetchImpl: garbage as unknown as typeof fetch }),
    ).rejects.toMatchObject({ kind: 'network' });
  });

  it('never puts the token in an error message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, { status: 401 }));
    const error = (await jiraFetch(config, 'x', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: JiraError) => e)) as JiraError;

    expect(error.message).not.toContain('secret');
  });
});

describe('daysUntilExpiry', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('counts whole days to an ISO date', () => {
    expect(daysUntilExpiry('2027-08-20', now)).toBe(364);
    expect(daysUntilExpiry('2026-09-10', now)).toBe(20);
  });

  it('goes negative once expired', () => {
    expect(daysUntilExpiry('2026-08-01', now)).toBeLessThan(0);
  });

  it('accepts a full timestamp', () => {
    expect(daysUntilExpiry('2026-08-30T12:00:00Z', now)).toBe(10);
  });

  it('returns null when unset or unparseable', () => {
    expect(daysUntilExpiry(undefined, now)).toBeNull();
    expect(daysUntilExpiry('', now)).toBeNull();
    expect(daysUntilExpiry('never', now)).toBeNull();
  });
});
