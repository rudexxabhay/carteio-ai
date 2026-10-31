import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  summary: vi.fn(), products: vi.fn(), conversations: vi.fn(), tickets: vi.fn(), connectors: vi.fn(),
}));
vi.mock('../services/api/dashboard', () => ({ getWorkspaceDashboardSummary: api.summary }));
vi.mock('../services/api/saas', () => ({ getProducts: api.products, getConversations: api.conversations, getTickets: api.tickets }));
vi.mock('../services/api/connectors', () => ({ getConnectors: api.connectors }));

import { useOverviewData } from '../dashboard-source/use-overview-data';

function OverviewProbe({ slug }: { slug: string }) {
  const data = useOverviewData(slug);
  return <output>{JSON.stringify({ slug: data.slug, loading: data.loading, products: data.products.map((product) => product.name) })}</output>;
}

const workspaceData = (slug: string) => ({
  summary: {}, products: { items: [{ id: `${slug}-product`, name: `${slug}-private-product` }] },
  conversations: { items: [], total: slug === 'alpha' ? 11 : 22 },
  tickets: { items: [], total: slug === 'alpha' ? 11 : 22, summary: { OPEN: 0 } },
  connectors: { items: [] },
});

describe('overview request isolation across workspace changes', () => {
  afterEach(() => { cleanup(); vi.resetAllMocks(); });

  it('hides old workspace data and ignores its late responses after switching', async () => {
    const oldResponses: Array<{ kind: keyof ReturnType<typeof workspaceData>; resolve: (value: unknown) => void }> = [];
    const response = (kind: keyof ReturnType<typeof workspaceData>, slug: string) => {
      const data = workspaceData(slug)[kind];
      if (slug !== 'alpha') return Promise.resolve(data);
      return new Promise((resolve) => oldResponses.push({ kind, resolve }));
    };
    api.summary.mockImplementation((slug: string) => response('summary', slug));
    api.products.mockImplementation((slug: string) => response('products', slug));
    api.conversations.mockImplementation((slug: string) => response('conversations', slug));
    api.tickets.mockImplementation((slug: string) => response('tickets', slug));
    api.connectors.mockImplementation((slug: string) => response('connectors', slug));

    const view = render(<OverviewProbe slug="alpha"/>);
    view.rerender(<OverviewProbe slug="beta"/>);
    expect(await screen.findByText(/beta-private-product/)).toBeInTheDocument();
    expect(screen.queryByText(/alpha-private-product/)).not.toBeInTheDocument();

    await act(async () => {
      for (const pending of oldResponses) pending.resolve(workspaceData('alpha')[pending.kind]);
    });
    expect(screen.getByText(/beta-private-product/)).toBeInTheDocument();
    expect(screen.queryByText(/alpha-private-product/)).not.toBeInTheDocument();
  });
});
