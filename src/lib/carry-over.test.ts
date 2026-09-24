import { describe, expect, it, vi } from 'vitest';
import {
  doneStatusIdsFromConfiguration,
  endSprintAndCarryOver,
  fetchUnfinishedIssueKeys,
  MAX_MOVE_PER_CALL,
  moveIssuesToSprint,
  unfinishedKeysFromIssuesPage,
} from './carry-over';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

const boardConfig = {
  columnConfig: {
    columns: [
      { name: 'To Do', statuses: [{ id: '1' }] },
      { name: 'In Progress', statuses: [{ id: '3' }] },
      { name: 'Done', statuses: [{ id: '10000' }] },
    ],
  },
};

const active = { id: 42, name: 'REX Sprint 32', state: 'active', goal: 'ship it' };
const closed = { id: 41, name: 'REX Sprint 31', state: 'closed', goal: 'shipped' };
const future = { id: 43, name: 'REX Sprint 33', state: 'future', goal: 'later' };

const issuePage = {
  issues: [
    { key: 'REX-1', fields: { status: { id: '1', statusCategory: { key: 'new' } } } },
    { key: 'REX-2', fields: { status: { id: '10000', statusCategory: { key: 'done' } } } },
    { key: 'REX-3', fields: { status: { id: '3', statusCategory: { key: 'indeterminate' } } } },
  ],
  isLast: true,
};

interface Call {
  url: string;
  method: string;
  body: unknown;
}

interface FakeOptions {
  sprints?: unknown[];
  /** Successive board listings, when a test needs the board to change mid-flow. */
  sprintListings?: unknown[][];
  /** Per-listing HTTP status; non-200 makes the n-th board listing fail. */
  listingStatus?: (index: number) => number;
  configuration?: unknown;
  configurationStatus?: number;
  issuePages?: unknown[];
  createId?: number;
  /** Per-move-call HTTP status; defaults to 204 for every call. */
  moveStatus?: (index: number) => number;
}

/**
 * A fake Jira that routes by path and method. Every request is recorded so the
 * tests can assert both what was sent and, more importantly, the order: the
 * close must precede the move.
 */
function fakeJira(options: FakeOptions = {}) {
  const sprints = options.sprints ?? [active, closed, future];
  const pages = options.issuePages ?? [issuePage];
  const configuration = options.configuration ?? boardConfig;

  const calls: Call[] = [];
  let pageIndex = 0;
  let moveIndex = 0;
  let listingIndex = 0;

  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url, method, body });

    if (method === 'GET' && /\/board\/\d+\/sprint/.test(url)) {
      const index = listingIndex;
      listingIndex += 1;
      const status = options.listingStatus?.(index);
      if (status !== undefined && status !== 200) return new Response('{}', { status });

      const listings = options.sprintListings;
      const values = listings
        ? (listings[index] ?? listings[listings.length - 1] ?? [])
        : sprints;
      return json({ values, isLast: true });
    }
    if (method === 'GET' && /\/board\/\d+\/configuration/.test(url)) {
      if (options.configurationStatus !== undefined) {
        return new Response('{}', { status: options.configurationStatus });
      }
      return json(configuration);
    }
    if (method === 'GET' && /\/sprint\/\d+\/issue/.test(url)) {
      const page = pages[pageIndex] ?? pages[pages.length - 1] ?? { issues: [], isLast: true };
      pageIndex += 1;
      return json(page);
    }
    if (method === 'POST' && /\/sprint\/\d+\/issue/.test(url)) {
      const status = options.moveStatus?.(moveIndex) ?? 204;
      moveIndex += 1;
      return new Response(status === 204 ? null : JSON.stringify({ errorMessages: ['no'] }), {
        status,
      });
    }
    if (method === 'POST' && /\/sprint\/\d+$/.test(url)) {
      return json({ id: 42, name: 'REX Sprint 32', state: 'closed', goal: 'g' });
    }
    if (method === 'POST' && /\/sprint$/.test(url)) {
      const name = (body as { name?: string } | null)?.name ?? '';
      return json({ id: options.createId ?? 44, name, state: 'future' }, 201);
    }
    throw new Error(`unexpected ${method} ${url}`);
  });

  return {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    calls,
    posts: () => calls.filter((call) => call.method === 'POST'),
    moves: () => calls.filter((call) => call.method === 'POST' && /\/issue$/.test(call.url)),
    creations: () =>
      calls.filter((call) => call.method === 'POST' && /\/sprint$/.test(call.url)),
  };
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('doneStatusIdsFromConfiguration', () => {
  it('reads the last column that has statuses', () => {
    const ids = doneStatusIdsFromConfiguration(boardConfig);
    expect(ids).toEqual(new Set(['10000']));
  });

  it('skips a trailing column with no statuses', () => {
    const ids = doneStatusIdsFromConfiguration({
      columnConfig: {
        columns: [
          { name: 'To Do', statuses: [{ id: '1' }] },
          { name: 'Done', statuses: [{ id: '5' }] },
          { name: 'Empty', statuses: [] },
        ],
      },
    });
    expect(ids).toEqual(new Set(['5']));
  });

  it('returns null when the configuration is unreadable', () => {
    expect(doneStatusIdsFromConfiguration(null)).toBeNull();
    expect(doneStatusIdsFromConfiguration({ columnConfig: {} })).toBeNull();
    expect(doneStatusIdsFromConfiguration({ columnConfig: { columns: [] } })).toBeNull();
  });
});

describe('unfinishedKeysFromIssuesPage', () => {
  it('keeps the issues outside the board Done column', () => {
    const ids = doneStatusIdsFromConfiguration(boardConfig);
    expect(unfinishedKeysFromIssuesPage(issuePage, ids)).toEqual(['REX-1', 'REX-3']);
  });

  it('lets the board column win over the status category', () => {
    // '3' is in the Done category but the board maps it to In Progress, so the
    // board's own column is what decides.
    const page = {
      issues: [{ key: 'REX-9', fields: { status: { id: '3', statusCategory: { key: 'done' } } } }],
    };
    expect(unfinishedKeysFromIssuesPage(page, new Set(['10000']))).toEqual(['REX-9']);
  });

  it('falls back to the status category when the column list is unknown', () => {
    expect(unfinishedKeysFromIssuesPage(issuePage, null)).toEqual(['REX-1', 'REX-3']);
  });

  it('counts an issue with no readable status as unfinished', () => {
    const page = { issues: [{ key: 'REX-7', fields: {} }] };
    expect(unfinishedKeysFromIssuesPage(page, new Set(['10000']))).toEqual(['REX-7']);
  });

  it('skips issues with no key', () => {
    const page = { issues: [{ fields: { status: { id: '1' } } }] };
    expect(unfinishedKeysFromIssuesPage(page, null)).toEqual([]);
  });
});

describe('fetchUnfinishedIssueKeys', () => {
  it('reads the board configuration, then the sprint issues', async () => {
    const jira = fakeJira();

    const keys = await fetchUnfinishedIssueKeys(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(keys).toEqual(['REX-1', 'REX-3']);
    expect(jira.calls[0]!.url).toContain('/board/66/configuration');
    expect(jira.calls[1]!.url).toContain('/sprint/42/issue');
  });

  it('falls back to the status category when the board config cannot be read', async () => {
    const jira = fakeJira({ configurationStatus: 403 });

    const keys = await fetchUnfinishedIssueKeys(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(keys).toEqual(['REX-1', 'REX-3']);
  });

  it('pages until the listing ends', async () => {
    const first = {
      issues: [{ key: 'REX-1', fields: { status: { id: '1' } } }],
      isLast: false,
      total: 2,
    };
    const second = {
      issues: [{ key: 'REX-2', fields: { status: { id: '1' } } }],
      isLast: true,
      total: 2,
    };
    const jira = fakeJira({ issuePages: [first, second] });

    const keys = await fetchUnfinishedIssueKeys(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(keys).toEqual(['REX-1', 'REX-2']);
    expect(jira.calls.filter((call) => /\/sprint\/42\/issue/.test(call.url))).toHaveLength(2);
  });
});

describe('moveIssuesToSprint', () => {
  it('sends keys in Jira\'s 50-per-call limit', async () => {
    const jira = fakeJira();
    const keys = Array.from({ length: MAX_MOVE_PER_CALL + 1 }, (_, i) => `REX-${i + 1}`);

    const result = await moveIssuesToSprint(config, 43, keys, { fetchImpl: jira.fetchImpl });

    expect(result).toEqual({ moved: 51, error: null });
    const moves = jira.moves();
    expect(moves).toHaveLength(2);
    expect((moves[0]!.body as { issues: string[] }).issues).toHaveLength(MAX_MOVE_PER_CALL);
    expect((moves[1]!.body as { issues: string[] }).issues).toEqual(['REX-51']);
  });

  it('reports what landed when Jira refuses a chunk', async () => {
    const jira = fakeJira({ moveStatus: () => 403 });
    const keys = Array.from({ length: MAX_MOVE_PER_CALL + 1 }, (_, i) => `REX-${i + 1}`);

    const result = await moveIssuesToSprint(config, 43, keys, { fetchImpl: jira.fetchImpl });

    expect(result.moved).toBe(0);
    expect(result.error).toBeTruthy();
    expect(jira.moves()).toHaveLength(1);
  });
});

describe('endSprintAndCarryOver', () => {
  it('closes the sprint, then moves the unfinished issues to the next future sprint', async () => {
    const jira = fakeJira();

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome).toMatchObject({
      unfinished: 2,
      moved: 2,
      carryError: null,
      target: { id: 43, name: 'REX Sprint 33', created: false },
    });

    const moves = jira.moves();
    expect(moves).toHaveLength(1);
    expect(moves[0]!.url).toBe('https://example.atlassian.net/rest/agile/1.0/sprint/43/issue');
    expect((moves[0]!.body as { issues: string[] }).issues).toEqual(['REX-1', 'REX-3']);

    // Close before move: moving first would file these as "removed" in Jira's
    // Sprint Report instead of "not completed".
    const closeAt = jira.calls.findIndex(
      (call) => call.method === 'POST' && call.url.endsWith('/sprint/42'),
    );
    const moveAt = jira.calls.findIndex((call) => call.url.endsWith('/sprint/43/issue'));
    expect(closeAt).toBeGreaterThanOrEqual(0);
    expect(moveAt).toBeGreaterThan(closeAt);
  });

  it('creates the next sprint when the board has none', async () => {
    const jira = fakeJira({ sprints: [active, closed] });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome.target).toEqual({ id: 44, name: 'REX Sprint 33', created: true });

    const creations = jira.creations();
    expect(creations).toHaveLength(1);
    expect(creations[0]!.body).toEqual({ name: 'REX Sprint 33', originBoardId: 66 });
    expect(jira.moves()).toHaveLength(1);
  });

  it('closes without creating anything when there is no unfinished work', async () => {
    const allDone = {
      issues: [{ key: 'REX-2', fields: { status: { id: '10000', statusCategory: { key: 'done' } } } }],
      isLast: true,
    };
    const jira = fakeJira({ issuePages: [allDone] });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome).toMatchObject({ unfinished: 0, moved: 0, target: null });
    expect(jira.creations()).toHaveLength(0);
    expect(jira.moves()).toHaveLength(0);
    // The close still happened.
    expect(jira.posts().some((call) => call.url.endsWith('/sprint/42'))).toBe(true);
  });

  it('refuses a sprint that is not the active one, without any write', async () => {
    const jira = fakeJira();

    const result = await endSprintAndCarryOver(config, 66, 41, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-active');
    expect(jira.posts()).toHaveLength(0);
  });

  it('still closes and reports the carry when the move is refused', async () => {
    const jira = fakeJira({ moveStatus: () => 403 });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome).toMatchObject({ unfinished: 2, moved: 0 });
    expect(result.outcome.target).toMatchObject({ id: 43 });
    expect(result.outcome.carryError).toContain('0 of 2 moved');
  });

  it('leaves the issues in the backlog when no next sprint can be named', async () => {
    const jira = fakeJira({
      sprints: [
        { id: 42, name: 'Ship it', state: 'active', goal: '' },
        { id: 41, name: 'Ship it', state: 'closed', goal: '' },
      ],
    });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome.target).toBeNull();
    expect(result.outcome.moved).toBe(0);
    expect(result.outcome.carryError).toContain('backlog');
    expect(jira.creations()).toHaveLength(0);
    expect(jira.moves()).toHaveLength(0);
  });

  it('closes even when the board config read fails, carrying by status category', async () => {
    const jira = fakeJira({ configurationStatus: 403 });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome.moved).toBe(2);
  });

  it('refuses to close when the issue listing never ends', async () => {
    // A page that always claims more and reports a huge total: the page cap is
    // the only thing that stops it. Closing on a partial list would strand the
    // issues past the cap in the backlog.
    const page = {
      issues: [{ key: 'REX-1', fields: { status: { id: '1' } } }],
      isLast: false,
      total: 100_000,
    };
    const jira = fakeJira({ issuePages: [page] });

    await expect(
      endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl }),
    ).rejects.toMatchObject({ name: 'JiraError', kind: 'upstream' });

    expect(jira.posts()).toHaveLength(0);
  });

  it('picks the successor from the board as it is after the close', async () => {
    const jira = fakeJira({
      // No future sprint at guard time; one exists by the time the issues are
      // read and the sprint is closed. The later listing is the one that counts.
      sprintListings: [
        [active, closed],
        [active, closed, future],
      ],
    });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome.target).toEqual({ id: 43, name: 'REX Sprint 33', created: false });
    expect(jira.creations()).toHaveLength(0);
    expect(jira.moves()).toHaveLength(1);
  });

  it('reports the carry when the board listing fails after the close', async () => {
    const jira = fakeJira({ listingStatus: (index) => (index === 1 ? 403 : 200) });

    const result = await endSprintAndCarryOver(config, 66, 42, { fetchImpl: jira.fetchImpl });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.outcome).toMatchObject({ unfinished: 2, moved: 0, target: null });
    expect(result.outcome.carryError).toContain('backlog');
    // The close still happened; only the aftermath is in doubt.
    expect(jira.posts().some((call) => call.url.endsWith('/sprint/42'))).toBe(true);
    expect(jira.moves()).toHaveLength(0);
  });
});
