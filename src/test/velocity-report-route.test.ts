import { describe, expect, it, vi } from 'vitest';
import { GET } from '../pages/api/velocity-report';

/**
 * Route-level tests for the velocity report series.
 *
 * `global.fetch` throws for the whole file. The route's guards — unknown team,
 * team with no board — must answer before any Jira call is possible, and the
 * test stub supplies no credentials, so anything that gets past them lands in
 * `readJiraConfig` and throws `unconfigured` rather than reaching the network.
 * Either way nothing here can touch a live board.
 *
 * The route is read-only, so unlike end-sprint there is no irreversible action
 * to guard; what these assert is the *degradation contract*, which is the whole
 * design of this endpoint: every failure short of a bad token is a 200 with
 * `{available:false}`, so the dialog can say "no report" instead of showing an
 * error the user cannot act on.
 */
const neverFetch = vi.fn(async () => {
  throw new Error('a guard let a request reach the network');
});
vi.stubGlobal('fetch', neverFetch);

const call = (search: string) =>
  GET({
    url: new URL(`https://retro.example/api/velocity-report${search}`),
  } as unknown as Parameters<typeof GET>[0]) as Promise<Response>;

async function bodyOf(response: Response) {
  return (await response.json()) as {
    available?: boolean;
    series?: unknown;
    error?: string;
    kind?: string;
  };
}

describe('GET /api/velocity-report', () => {
  it('degrades for an unknown team without calling Jira', async () => {
    const response = await call('?team=nope');

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ available: false });
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('degrades when the team parameter is missing entirely', async () => {
    const response = await call('');

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ available: false });
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('degrades rather than erroring when Jira is unconfigured', async () => {
    // A real team, so the guards pass and `readJiraConfig` is reached. The test
    // env is deliberately empty, which is the "secrets missing" case: it must
    // read as "no report available", never as a 5xx.
    const response = await call('?team=rex');

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toEqual({ available: false });
  });

  it('never sets a cacheable response — sprint numbers change at close', async () => {
    const response = await call('?team=rex');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  it('leaves /api/velocity untouched — the two routes are separate', async () => {
    // Backward compatibility: the single-sprint route still answers with the
    // old two-number shape and knows nothing about the series.
    const { GET: velocityGet } = await import('../pages/api/velocity');
    const response = (await velocityGet({
      url: new URL('https://retro.example/api/velocity?team=rex&sprintId=3592'),
    } as unknown as Parameters<typeof velocityGet>[0])) as Response;

    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toEqual({ available: false });
    expect(body).not.toHaveProperty('series');
  });
});
