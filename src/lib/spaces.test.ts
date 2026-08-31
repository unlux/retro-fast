import { describe, expect, it, vi } from 'vitest';
import { fetchBoardSpaceName, spaceNameFromBoardConfiguration } from './spaces';

const config = { site: 'https://example.atlassian.net', email: 'a@b.c', token: 'secret' };

describe('spaceNameFromBoardConfiguration', () => {
  it('reads the documented project location name', () => {
    expect(
      spaceNameFromBoardConfiguration({
        location: { type: 'project', id: '10010', key: 'REX', name: 'Rex Space' },
      }),
    ).toBe('Rex Space');
  });

  it('accepts older Jira Cloud project-name variants', () => {
    expect(
      spaceNameFromBoardConfiguration({
        location: { type: 'project', projectName: 'Skillion Labs' },
      }),
    ).toBe('Skillion Labs');
    expect(
      spaceNameFromBoardConfiguration({
        location: { type: 'PROJECT', displayName: 'Marketing' },
      }),
    ).toBe('Marketing');
  });

  it('does not mistake a user-owned board for a Space', () => {
    expect(
      spaceNameFromBoardConfiguration({
        location: { type: 'user', name: 'Pete Cooper' },
      }),
    ).toBeNull();
  });

  it.each([
    null,
    {},
    { location: null },
    { location: { type: 'project', name: '   ' } },
  ])('returns null for malformed or nameless input %#', (value) => {
    expect(spaceNameFromBoardConfiguration(value)).toBeNull();
  });
});

describe('fetchBoardSpaceName', () => {
  it('reads the configured board rather than accepting a project from the client', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          location: { type: 'project', name: 'Rex Space' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;

    await expect(fetchBoardSpaceName(config, 66, { fetchImpl })).resolves.toBe('Rex Space');

    const url = String(
      (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]![0],
    );
    expect(url).toBe(
      'https://example.atlassian.net/rest/agile/1.0/board/66/configuration',
    );
  });
});
