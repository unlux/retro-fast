import { describe, expect, it, vi } from 'vitest';
import { POST as createSprint } from '../pages/api/create-sprint';
import { POST as setGoal } from '../pages/api/set-goal';

/**
 * Route-level tests for the two Plan-tab writes.
 *
 * Same shape as the end-sprint route suite: `global.fetch` throws for the whole
 * file, so a guard that stopped short-circuiting would fail loudly rather than
 * quietly reaching the network. The deeper guards (board membership, sprint
 * state) are covered against a fake Jira in `src/lib/set-goal.test.ts`.
 */
const neverFetch = vi.fn(async () => {
  throw new Error('a guard let a request reach the network');
});
vi.stubGlobal('fetch', neverFetch);

const post = (path: string, body: unknown, raw?: string) =>
  new Request(`https://retro.example/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  });

type Handler = typeof setGoal;
const call = (handler: Handler, request: Request) =>
  handler({ request } as unknown as Parameters<Handler>[0]) as Promise<Response>;

async function bodyOf(response: Response) {
  return (await response.json()) as { error?: string; kind?: string };
}

describe('POST /api/set-goal — request guards', () => {
  const valid = { team: 'rex', sprintId: 43, goal: 'Ship it' };
  const send = (body: unknown, raw?: string) =>
    call(setGoal, post('set-goal', body, raw));

  it('rejects a body that is not JSON', async () => {
    const response = await send(null, 'not json at all');

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing team', { sprintId: 43, goal: 'x' }],
    ['a bogus team', { team: 'not-a-team', sprintId: 43, goal: 'x' }],
    ['a non-string team', { team: 42, sprintId: 43, goal: 'x' }],
  ])('rejects %s', async (_label, body) => {
    const response = await send(body);

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('unknown-team');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['an empty array', []],
    ['a boolean', true],
    ['a non-numeric string', 'latest'],
    ['zero', 0],
    ['a negative number', -3],
    ['a fraction', 4.5],
  ])('rejects %s as a sprintId', async (_label, sprintId) => {
    const response = await send({ ...valid, sprintId });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['all whitespace', '   \n\t '],
    ['a number', 42],
    ['an object', { text: 'x' }],
  ])('rejects %s as a goal', async (_label, goal) => {
    const response = await send({ ...valid, goal });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('rejects an absurdly long goal', async () => {
    const response = await send({ ...valid, goal: 'x'.repeat(32_001) });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('never returns anything token-shaped in an error body', async () => {
    const response = await send({ team: 'nope', sprintId: 1, goal: 'x' });

    expect(JSON.stringify(await bodyOf(response)).toLowerCase()).not.toContain('token');
  });

  it('reports Jira as unconfigured rather than calling out with empty credentials', async () => {
    // Past every request guard, with a known team and a plausible sprint id.
    // The test env supplies no secrets, so `readJiraConfig` throws first — and
    // crucially, `fetch` is still never reached.
    const response = await send(valid);

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).kind).toBe('unconfigured');
    expect(neverFetch).not.toHaveBeenCalled();
  });
});

describe('POST /api/create-sprint — request guards', () => {
  const send = (body: unknown, raw?: string) =>
    call(createSprint, post('create-sprint', body, raw));

  it('rejects a body that is not JSON', async () => {
    const response = await send(null, '{{{');

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing team', { name: 'REX Sprint 33' }],
    ['a bogus team', { team: 'not-a-team', name: 'REX Sprint 33' }],
  ])('rejects %s', async (_label, body) => {
    const response = await send(body);

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('unknown-team');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['empty', ''],
    ['all whitespace', '   '],
    ['a number', 42],
    ['an array', ['REX Sprint 33']],
    ['absurdly long', 'x'.repeat(256)],
  ])('rejects %s as a name', async (_label, name) => {
    const response = await send({ team: 'rex', name });

    expect(response.status).toBe(400);
    expect((await bodyOf(response)).kind).toBe('bad-request');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('takes the board from config, never from the request body', async () => {
    // A client naming its own board must not be able to create there. The
    // handler reads `team.boardId`, so this extra field is simply ignored —
    // and the request still dies at the unconfigured-credentials stage.
    const response = await send({ team: 'rex', name: 'REX Sprint 33', boardId: 999 });

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).kind).toBe('unconfigured');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('reports Jira as unconfigured rather than calling out with empty credentials', async () => {
    const response = await send({ team: 'rex', name: 'REX Sprint 33' });

    expect(response.status).toBe(503);
    expect((await bodyOf(response)).kind).toBe('unconfigured');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('never returns anything token-shaped in an error body', async () => {
    const response = await send({ team: 'nope', name: 'x' });

    expect(JSON.stringify(await bodyOf(response)).toLowerCase()).not.toContain('token');
  });
});
