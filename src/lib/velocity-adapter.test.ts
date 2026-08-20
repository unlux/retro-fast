import { describe, expect, it, vi } from 'vitest';
import { JiraError } from './jira';
import { fetchVelocity, readVelocityEntry } from './velocity-adapter';

/**
 * Payload shaped like the real greenhopper response (see
 * docs/research/jira-discovery.md §3), including the fact that
 * `velocityStatEntries` is an unordered dict keyed by sprint id.
 */
const rexPayload = {
  sprints: [
    { id: 3592, name: 'REX Sprint 31' },
    { id: 3587, name: 'REX Sprint 30' },
  ],
  velocityStatEntries: {
    // Deliberately not in recency order — recency must never be inferred here.
    '3585': { estimated: { value: 13.0 }, completed: { value: 7.0 } },
    '3592': { estimated: { value: 7.0 }, completed: { value: 6.0 } },
    '3587': { estimated: { value: 5.0 }, completed: { value: 2.0 } },
  },
};

describe('readVelocityEntry', () => {
  it('reads the real Rex sprint 31 numbers by id', () => {
    expect(readVelocityEntry(rexPayload, 3592)).toEqual({
      available: true,
      committed: 7,
      completed: 6,
    });
  });

  it('reads a sprint that is not first in the dict', () => {
    expect(readVelocityEntry(rexPayload, 3587)).toEqual({
      available: true,
      committed: 5,
      completed: 2,
    });
    expect(readVelocityEntry(rexPayload, 3585)).toEqual({
      available: true,
      committed: 13,
      completed: 7,
    });
  });

  it('is unavailable for an active sprint with no entry yet', () => {
    // SL sprint 3591 is active: closed-sprint snapshots simply do not exist.
    expect(readVelocityEntry(rexPayload, 3591)).toEqual({ available: false });
  });

  it('is unavailable for a bogus sprint id', () => {
    expect(readVelocityEntry(rexPayload, 999999)).toEqual({ available: false });
  });

  it('accepts string point values', () => {
    const body = { velocityStatEntries: { '1': { estimated: { value: '32.0' }, completed: { value: '17.0' } } } };
    expect(readVelocityEntry(body, 1)).toEqual({ available: true, committed: 32, completed: 17 });
  });

  it('is unavailable when the shape is wrong or empty', () => {
    expect(readVelocityEntry(null, 1)).toEqual({ available: false });
    expect(readVelocityEntry({}, 1)).toEqual({ available: false });
    expect(readVelocityEntry({ velocityStatEntries: {} }, 1)).toEqual({ available: false });
    expect(readVelocityEntry({ velocityStatEntries: { '1': {} } }, 1)).toEqual({ available: false });
    expect(
      readVelocityEntry({ velocityStatEntries: { '1': { estimated: { value: 'n/a' } } } }, 1),
    ).toEqual({ available: false });
  });

  it('treats a blank or whitespace-only point value as missing, not zero', () => {
    // `Number('')` is 0, which would prefill a confident "0 points" for a
    // sprint that reported nothing at all.
    for (const value of ['', '   ', '\t\n']) {
      expect(
        readVelocityEntry(
          { velocityStatEntries: { '1': { estimated: { value }, completed: { value: 3 } } } },
          1,
        ),
      ).toEqual({ available: false });
    }
  });

  it('needs both numbers to report availability', () => {
    const body = { velocityStatEntries: { '1': { estimated: { value: 5 } } } };
    expect(readVelocityEntry(body, 1)).toEqual({ available: false });
  });

  it('handles zero as a real value, not a missing one', () => {
    const body = { velocityStatEntries: { '1': { estimated: { value: 0 }, completed: { value: 0 } } } };
    expect(readVelocityEntry(body, 1)).toEqual({ available: true, committed: 0, completed: 0 });
  });
});

describe('fetchVelocity', () => {
  const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

  const respond = (body: unknown, status = 200) =>
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

  it('returns the sprint entry on success', async () => {
    const fetchImpl = respond(rexPayload);
    await expect(fetchVelocity(config, 66, 3592, { fetchImpl })).resolves.toEqual({
      available: true,
      committed: 7,
      completed: 6,
    });
  });

  it('rethrows a 401 as unauthorized', async () => {
    const fetchImpl = respond({ errorMessages: ['nope'] }, 401);
    await expect(fetchVelocity(config, 66, 3592, { fetchImpl })).rejects.toMatchObject({
      kind: 'unauthorized',
    });
  });

  it('rethrows greenhopper 403 as unauthorized, not silent unavailability', async () => {
    // Regression: with an invalid token the greenhopper endpoint answers 403
    // where the Agile API answers 401 (verified live). Degrading here would
    // hide an expired token behind permanently blank point fields.
    const fetchImpl = respond({}, 403);
    const error = await fetchVelocity(config, 66, 3592, { fetchImpl }).catch((e) => e);

    expect(error).toBeInstanceOf(JiraError);
    expect((error as JiraError).kind).toBe('unauthorized');
    expect((error as JiraError).message).toMatch(/invalid or has expired/);
  });

  it('degrades on 404, 500 and network failure', async () => {
    for (const status of [404, 500, 503]) {
      await expect(
        fetchVelocity(config, 66, 3592, { fetchImpl: respond({}, status) }),
      ).resolves.toEqual({ available: false });
    }

    const boom = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(fetchVelocity(config, 66, 3592, { fetchImpl: boom })).resolves.toEqual({
      available: false,
    });
  });

  it('degrades when the endpoint is gone entirely', async () => {
    const gone = vi.fn(async () => new Response('<html>Not Found', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchVelocity(config, 66, 3592, { fetchImpl: gone })).resolves.toEqual({
      available: false,
    });
  });
});
