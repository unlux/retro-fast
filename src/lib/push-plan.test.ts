import { describe, expect, it, vi } from 'vitest';
import { pushPlan } from './push-plan';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };
const future = { id: 42, name: 'Sprint 2', state: 'future', goal: '' };
const closed = { id: 41, name: 'Sprint 1', state: 'closed', goal: 'Old' };
const input = { goal: 'Ship it\n\nBAU\n[ ] Support', expectedSprintId: 42, expectedGoal: '' };
function jira(values: unknown[], failRead = false) {
  const writes: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes.push({ url: String(url), body });
      return Response.json({ ...future, id: 43, ...body });
    }
    if (failRead) return Response.json({ error: 'Unavailable' }, { status: 403 });
    return Response.json({ values, isLast: true });
  }) as typeof fetch;
  return { fetchImpl, writes };
}

describe('pushPlan', () => {
  it('reuses an existing empty sprint and writes only its goal', async () => {
    const api = jira([closed, future]);
    const result = await pushPlan(config, 66, input, api);
    expect(result.ok).toBe(true);
    expect(api.writes).toEqual([{ url: 'https://example.atlassian.net/rest/agile/1.0/sprint/42', body: { goal: input.goal } }]);
  });
  it('uses the last future sprint in board order, not the highest ID', async () => {
    const api = jira([{ ...future, id: 999 }, { ...future, id: 12 }]);
    await pushPlan(config, 66, { ...input, expectedSprintId: 12 }, api);
    expect(api.writes[0]?.url).toMatch(/sprint\/12$/);
  });
  it('creates with goals included in a single write only when no future sprint exists', async () => {
    const api = jira([closed]);
    const result = await pushPlan(config, 66, { ...input, expectedSprintId: null }, api);
    expect(result).toMatchObject({ ok: true, created: true });
    expect(api.writes).toEqual([{ url: 'https://example.atlassian.net/rest/agile/1.0/sprint',
      body: { name: 'Sprint 2', originBoardId: 66, goal: input.goal } }]);
  });
  it('requires a review instead of creating another sprint when one appeared', async () => {
    const api = jira([future]);
    expect(await pushPlan(config, 66, { ...input, expectedSprintId: null }, api)).toMatchObject({ ok: false, sprint: { id: 42 } });
    expect(api.writes).toEqual([]);
  });
  it('does not overwrite a goal edited since the preview', async () => {
    const api = jira([{ ...future, goal: 'Someone else edited this' }]);
    expect(await pushPlan(config, 66, input, api)).toMatchObject({ ok: false });
    expect(api.writes).toEqual([]);
  });
  it.each(['active', 'closed'])('never updates a sprint that became %s', async state => {
    const api = jira([{ ...future, state }]);
    expect(await pushPlan(config, 66, input, api)).toMatchObject({ ok: false, sprint: null });
    expect(api.writes).toEqual([]);
  });
  it('retries a lost creation response without creating or appending twice', async () => {
    const api = jira([{ ...future, goal: input.goal }]);
    expect(await pushPlan(config, 66, { ...input, expectedSprintId: null }, api)).toMatchObject({ ok: true, created: false });
    expect(api.writes).toEqual([]);
  });
  it('does not create when the board listing fails', async () => {
    const api = jira([], true);
    await expect(pushPlan(config, 66, { ...input, expectedSprintId: null }, api)).rejects.toThrow();
    expect(api.writes).toEqual([]);
  });
  it('does not treat an unreadable future sprint as an empty board', async () => {
    const api = jira([{ name: 'Existing sprint', state: 'future' }]);
    await expect(pushPlan(config, 66, { ...input, expectedSprintId: null }, api)).rejects.toThrow();
    expect(api.writes).toEqual([]);
  });
});
