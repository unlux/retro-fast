import { describe, expect, it, vi } from 'vitest';
import { POST } from '../pages/api/push-plan';

const fetch = vi.fn(() => { throw new Error('Unexpected network request'); });
vi.stubGlobal('fetch', fetch);
const valid = { team: 'rex', goal: 'Ship it', expectedSprintId: null, expectedGoal: '' };
async function send(body: unknown) {
  return POST({ request: new Request('https://retro.test/api/push-plan', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }) } as Parameters<typeof POST>[0]) as Promise<Response>;
}
describe('push-plan request guards', () => {
  it.each([null, [], {}, { ...valid, team: 'other' }, { ...valid, goal: '' },
    { ...valid, goal: 'x'.repeat(32001) }, { ...valid, expectedSprintId: '42' },
    { ...valid, expectedSprintId: -1 }, { ...valid, expectedGoal: null },
    { ...valid, expectedSprintId: undefined }])('rejects malformed requests without a Jira call', async body => {
      expect((await send(body)).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });
  it('requires configured credentials after validation', async () => {
    expect((await send(valid)).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
