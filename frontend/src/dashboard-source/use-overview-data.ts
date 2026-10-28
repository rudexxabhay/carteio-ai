import { useEffect, useState } from 'react';
import { getWorkspaceDashboardSummary, type WorkspaceDashboardSummary } from '../services/api/dashboard';
import { getConversations, getProducts, getTickets, type InboxPage, type Product, type TicketPage } from '../services/api/saas';
import { getConnectors, type ConnectorInstance } from '../services/api/connectors';

export type OverviewData = {
  slug: string;
  loading: boolean;
  summary: WorkspaceDashboardSummary | null;
  products: Product[];
  conversations: InboxPage | null;
  openTickets: TicketPage | null;
  connectors: ConnectorInstance[] | null;
  failed: { summary: boolean; products: boolean; conversations: boolean; openTickets: boolean; connectors: boolean };
};

export function useOverviewData(slug: string): OverviewData {
  const [state, setState] = useState<OverviewData>({
    slug: '', loading: true, summary: null, products: [], conversations: null, openTickets: null, connectors: null,
    failed: { summary: false, products: false, conversations: false, openTickets: false, connectors: false },
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ slug, loading: true, summary: null, products: [], conversations: null, openTickets: null, connectors: null, failed: { summary: false, products: false, conversations: false, openTickets: false, connectors: false } });
    void Promise.allSettled([
      getWorkspaceDashboardSummary(slug, controller.signal),
      getProducts(slug, 1, '', controller.signal),
      getConversations(slug, { page: 1, pageSize: 1 }, controller.signal),
      getTickets(slug, { page: 1, pageSize: 1, status: 'OPEN' }, controller.signal),
      getConnectors(slug, controller.signal),
    ]).then(([summaryResult, productsResult, conversationsResult, ticketsResult, connectorsResult]) => {
      if (controller.signal.aborted) return;
      setState({
        slug,
        loading: false,
        summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
        products: productsResult.status === 'fulfilled' ? productsResult.value.items.slice(0, 3) : [],
        conversations: conversationsResult.status === 'fulfilled' ? conversationsResult.value : null,
        openTickets: ticketsResult.status === 'fulfilled' ? ticketsResult.value : null,
        connectors: connectorsResult.status === 'fulfilled' ? connectorsResult.value.items : null,
        failed: {
          summary: summaryResult.status === 'rejected',
          products: productsResult.status === 'rejected',
          conversations: conversationsResult.status === 'rejected',
          openTickets: ticketsResult.status === 'rejected',
          connectors: connectorsResult.status === 'rejected',
        },
      });
    });
    return () => controller.abort();
  }, [slug]);

  // Never render a previous workspace's response while a newly selected workspace is loading.
  return state.slug === slug ? state : {
    slug, loading: true, summary: null, products: [], conversations: null, openTickets: null, connectors: null,
    failed: { summary: false, products: false, conversations: false, openTickets: false, connectors: false },
  };
}
