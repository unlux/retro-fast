import { describe, expect, it, vi } from 'vitest';
import { POST } from '../pages/api/end-sprint';

/**
 * Route-level tests for the app's only Jira write.
 *
 * These exercise the request-validation guards — the checks that run before any
 * Jira call is possible. `global.fetch` is stubbed to throw for the whole file:
 * if a guard ever stopped short-circuiting and let a request through, the test
 * would fail loudly instead of quietly reaching the network. The deeper guards
 * (board membership, active state) are covered against a fake Jira in
 * `src/lib/close-sprint.test.ts`.
 */
const neverFetch = vi.fn(async () => {
  throw new Error('a guard let a request reach the network');
});
vi.stubGlobal('fetch', neverFetch);

/** Build the request the route expects, with an arbitrary body. */
const post = (body: unknown, raw?: string) =>
  new Request('https://retro.example/api/end-sprint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

/** Astro hands the handler a context object; only `request` is read here. */
const call = (request: Request) =>
  POST({ request } as unknown as Parameters<typeof POST>[0]) as Promise<Response>;

async function bodyOf(response: Response) {
  return (await response.json()) as { error?: string; kind?: string };
}

describe('POST /api/end-sprint — request guards', () => {
  it('rejects a body that is not JSON', async () => {
    const response = await call(post(null, 'not json at all'));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('rejects a missing team', async () => {
    const response = await call(post({ sprintId: 42 }));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('unknown-team');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('rejects a bogus team', async () => {
    const response = await call(post({ team: 'not-a-team', sprintId: 42 }));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('unknown-team');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('rejects a missing sprintId', async () => {
    const response = await call(post({ team: 'rex' }));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['null', null],
    ['an empty array', []],
    ['a boolean', true],
    ['a non-numeric string', 'latest'],
    ['zero', 0],
    ['a negative number', -3],
    ['a fraction', 4.5],
  ])('rejects %s as a sprintId', async (_label, sprintId) => {
    const response = await call(post({ team: 'rex', sprintId }));

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('never returns anything token-shaped in an error body', async () => {
    const response = await call(post({ team: 'nope', sprintId: 1 }));

    expect(JSON.stringify(await bodyOf(response)).toLowerCase()).not.toContain('token');
  });

  it('reports Jira as unconfigured rather than calling out with empty credentials', async () => {
    // Past every request guard, with a known team and a plausible sprint id.
    // The test env supplies no secrets, so `readJiraConfig` throws first — and
    // crucially, `fetch` is still never reached.
    const response = await call(post({ team: 'rex', sprintId: 42 }));

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).kind).toBe('unconfigured');
    expect(neverFetch).not.toHaveBeenCalled();
  });
});
