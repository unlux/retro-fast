import { describe, expect, it, vi } from 'vitest';
import { GET } from '../pages/api/spaces';

const neverFetch = vi.fn(async () => {
  throw new Error('an unconfigured route reached the network');
});
vi.stubGlobal('fetch', neverFetch);

describe('GET /api/spaces', () => {
  it('reports missing Jira credentials without reaching the network', async () => {
    const response = (await GET({} as Parameters<typeof GET>[0])) as Response;
    const body = (await response.json()) as { error?: string; kind?: string };

    expect(response.status).toBe(503);
    expect(body.kind).toBe('unconfigured');
    expect(body.error).toContain('Jira is not configured');
    expect(neverFetch).not.toHaveBeenCalled();
  });

  it('never caches names because Jira remains their source of truth', async () => {
    const response = (await GET({} as Parameters<typeof GET>[0])) as Response;

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toContain('application/json');
  });
});
