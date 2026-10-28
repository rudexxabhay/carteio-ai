import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../services/api/client', () => ({
  apiDelete: vi.fn(), apiGet, apiPatch: vi.fn(), apiPost: vi.fn(),
}));

import { getConnectorSyncHistory } from '../services/api/connectors';

describe('connector sync history cursor contract', () => {
  beforeEach(() => apiGet.mockReset());

  it('requests the next page using the backend before cursor', () => {
    const signal = new AbortController().signal;
    getConnectorSyncHistory('carteio', 'connector-id', signal, '2026-10-20T10:00:00.000Z~job-id');

    expect(apiGet).toHaveBeenCalledWith(
      '/workspaces/carteio/connectors/connector-id/sync-jobs?limit=20&before=2026-10-20T10%3A00%3A00.000Z%7Ejob-id',
      signal,
    );
  });
});
