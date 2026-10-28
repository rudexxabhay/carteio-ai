import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../services/api/client', () => ({
  apiDelete: vi.fn(),
  apiGet: api.apiGet,
  apiPatch: vi.fn(),
  apiPost: api.apiPost,
}));

import { crawlWebsiteSource, getWebsiteSourceDetails } from '../services/api/knowledge';

describe('website refresh route contract', () => {
  beforeEach(() => { api.apiGet.mockReset(); api.apiPost.mockReset(); });

  it('posts to the secured KnowledgeController website sync route', () => {
    crawlWebsiteSource('carteio', 'f5400e3a-4391-45a1-92e9-90e007c91640');

    expect(api.apiPost).toHaveBeenCalledWith(
      '/workspaces/carteio/knowledge/f5400e3a-4391-45a1-92e9-90e007c91640/website/sync',
      {},
    );
  });

  it('loads training status from the existing website details route', () => {
    getWebsiteSourceDetails('carteio', 'f5400e3a-4391-45a1-92e9-90e007c91640');

    expect(api.apiGet).toHaveBeenCalledWith(
      '/workspaces/carteio/knowledge/f5400e3a-4391-45a1-92e9-90e007c91640/website',
      undefined,
    );
  });
});
