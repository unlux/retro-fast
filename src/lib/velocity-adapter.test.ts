import { describe, expect, it, vi } from 'vitest';
import { JiraError } from './jira';
import {
  fetchVelocity,
  fetchVelocitySeries,
  readVelocityEntry,
  readVelocitySeries,
} from './velocity-adapter';

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

/**
 * The report series.
 *
 * Shaped like the real payload: `sprints` is an array in NEWEST-FIRST order
 * (verified against all three live boards) sitting beside the unordered
 * `velocityStatEntries` dict. The numbers below are the real Rex board 66
 * figures for sprints 29–31.
 */
const rexSeriesPayload = {
  sprints: [
    { id: 3592, name: 'REX Sprint 31', state: 'CLOSED' },
    { id: 3587, name: 'REX Sprint 30', state: 'CLOSED' },
    { id: 3585, name: 'REX Sprint 29', state: 'CLOSED' },
  ],
  velocityStatEntries: {
    // Deliberately not in the same order as `sprints`: order comes from the
    // array, never from the dict.
    '3587': { estimated: { value: 5.0 }, completed: { value: 2.0 } },
    '3592': { estimated: { value: 7.0 }, completed: { value: 6.0 } },
    '3585': { estimated: { value: 13.0 }, completed: { value: 7.0 } },
  },
};

describe('readVelocitySeries', () => {
  it('returns the real Rex series oldest-first', () => {
    expect(readVelocitySeries(rexSeriesPayload)).toEqual({
      available: true,
      series: [
        { sprintId: 3585, name: 'REX Sprint 29', committed: 13, completed: 7 },
        { sprintId: 3587, name: 'REX Sprint 30', committed: 5, completed: 2 },
        { sprintId: 3592, name: 'REX Sprint 31', committed: 7, completed: 6 },
      ],
    });
  });

  it('orders by the sprints array, never by sprint id', () => {
    // Ids do not increase with start date on these boards, so an id sort would
    // silently reorder the x-axis. The array order is the only recency signal.
    const body = {
      sprints: [
        { id: 10, name: 'Newest' },
        { id: 99, name: 'Middle' },
        { id: 50, name: 'Oldest' },
      ],
      velocityStatEntries: {
        '10': { estimated: { value: 1 }, completed: { value: 1 } },
        '99': { estimated: { value: 2 }, completed: { value: 2 } },
        '50': { estimated: { value: 3 }, completed: { value: 3 } },
      },
    };
    const result = readVelocitySeries(body);
    expect(result.available && result.series.map((point) => point.name)).toEqual([
      'Oldest',
      'Middle',
      'Newest',
    ]);
  });

  it('drops a sprint with no velocity entry rather than plotting zeroes', () => {
    // An active sprint has no snapshot — greenhopper only writes one at close.
    // Zero-filling would draw a catastrophic sprint that never happened.
    const body = {
      sprints: [
        { id: 3593, name: 'REX Sprint 32', state: 'ACTIVE' },
        { id: 3592, name: 'REX Sprint 31', state: 'CLOSED' },
      ],
      velocityStatEntries: {
        '3592': { estimated: { value: 7 }, completed: { value: 6 } },
      },
    };
    expect(readVelocitySeries(body)).toEqual({
      available: true,
      series: [{ sprintId: 3592, name: 'REX Sprint 31', committed: 7, completed: 6 }],
    });
  });

  it('drops a row missing either number', () => {
    const body = {
      sprints: [
        { id: 2, name: 'Half' },
        { id: 1, name: 'Whole' },
      ],
      velocityStatEntries: {
        '1': { estimated: { value: 4 }, completed: { value: 3 } },
        '2': { estimated: { value: 9 } },
      },
    };
    expect(readVelocitySeries(body)).toEqual({
      available: true,
      series: [{ sprintId: 1, name: 'Whole', committed: 4, completed: 3 }],
    });
  });

  it('keeps a genuine zero sprint', () => {
    // Rex sprints 20–22 really are 0/0. Those are data, not gaps.
    const body = {
      sprints: [{ id: 3497, name: 'REX Sprint 20' }],
      velocityStatEntries: { '3497': { estimated: { value: 0 }, completed: { value: 0 } } },
    };
    expect(readVelocitySeries(body)).toEqual({
      available: true,
      series: [{ sprintId: 3497, name: 'REX Sprint 20', committed: 0, completed: 0 }],
    });
  });

  it('accepts greenhopper string floats', () => {
    const body = {
      sprints: [{ id: 1, name: 'SL Sprint 11' }],
      velocityStatEntries: { '1': { estimated: { value: '32.0' }, completed: { value: '17.0' } } },
    };
    expect(readVelocitySeries(body)).toEqual({
      available: true,
      series: [{ sprintId: 1, name: 'SL Sprint 11', committed: 32, completed: 17 }],
    });
  });

  it('names a sprint whose name is missing or blank', () => {
    const body = {
      sprints: [{ id: 7 }, { id: 8, name: '   ' }],
      velocityStatEntries: {
        '7': { estimated: { value: 1 }, completed: { value: 1 } },
        '8': { estimated: { value: 2 }, completed: { value: 2 } },
      },
    };
    const result = readVelocitySeries(body);
    expect(result.available && result.series.map((point) => point.name)).toEqual([
      'Sprint 8',
      'Sprint 7',
    ]);
  });

  it('ignores rows with an unusable id', () => {
    const body = {
      sprints: [{ id: null }, { id: true }, { id: [] }, { id: 5, name: 'Real' }],
      velocityStatEntries: {
        '0': { estimated: { value: 9 }, completed: { value: 9 } },
        '1': { estimated: { value: 9 }, completed: { value: 9 } },
        '5': { estimated: { value: 2 }, completed: { value: 1 } },
      },
    };
    expect(readVelocitySeries(body)).toEqual({
      available: true,
      series: [{ sprintId: 5, name: 'Real', committed: 2, completed: 1 }],
    });
  });

  it('is unavailable when the shape is wrong, empty, or has no usable rows', () => {
    expect(readVelocitySeries(null)).toEqual({ available: false });
    expect(readVelocitySeries({})).toEqual({ available: false });
    expect(readVelocitySeries({ sprints: [] , velocityStatEntries: {} })).toEqual({
      available: false,
    });
    // Sprints present but not one has an entry: an empty chart is not a chart.
    expect(
      readVelocitySeries({ sprints: [{ id: 1, name: 'A' }], velocityStatEntries: {} }),
    ).toEqual({ available: false });
    // `sprints` absent: there is no recency signal, so there is no series.
    expect(
      readVelocitySeries({ velocityStatEntries: { '1': { estimated: { value: 1 }, completed: { value: 1 } } } }),
    ).toEqual({ available: false });
  });
});

describe('fetchVelocitySeries', () => {
  const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

  const respond = (body: unknown, status = 200) =>
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

  it('returns the whole series on success', async () => {
    const fetchImpl = respond(rexSeriesPayload);
    const result = await fetchVelocitySeries(config, 66, { fetchImpl });

    expect(result.available).toBe(true);
    expect(result.available && result.series).toHaveLength(3);
    expect(result.available && result.series[0]?.name).toBe('REX Sprint 29');
  });

  it('makes exactly one Jira call — the report costs no extra round trip', async () => {
    const fetchImpl = respond(rexSeriesPayload);
    await fetchVelocitySeries(config, 66, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain(
      'rest/greenhopper/1.0/rapid/charts/velocity?rapidViewId=66',
    );
  });

  it('rethrows 401 and greenhopper 403 as unauthorized', async () => {
    for (const status of [401, 403]) {
      await expect(
        fetchVelocitySeries(config, 66, { fetchImpl: respond({}, status) }),
      ).rejects.toMatchObject({ kind: 'unauthorized' });
    }
  });

  it('degrades on every other failure', async () => {
    for (const status of [404, 500, 503]) {
      await expect(
        fetchVelocitySeries(config, 66, { fetchImpl: respond({}, status) }),
      ).resolves.toEqual({ available: false });
    }

    const boom = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(fetchVelocitySeries(config, 66, { fetchImpl: boom })).resolves.toEqual({
      available: false,
    });
  });
});
