import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ workspace: { slug: 'north', name: 'North Workspace', role: 'owner' }, list: vi.fn(), website: vi.fn(), faq: vi.fn(), text: vi.fn(), patch: vi.fn(), archive: vi.fn() }));
vi.mock('../layouts/DashboardLayout/DashboardLayout', () => ({ useWorkspaceRoute: () => ({ workspace: mocks.workspace }) }));
vi.mock('../services/api/knowledge', () => ({ listKnowledge: mocks.list, createWebsiteSource: mocks.website, createFaqSource: mocks.faq, createTextSource: mocks.text, updateKnowledge: mocks.patch, archiveKnowledge: mocks.archive }));
import { KnowledgeBasePage } from '../pages/knowledge/KnowledgeBasePage';

const source = (id: string, name: string) => ({ id, organizationId: 'org', createdById: 'user', type: 'website' as const, status: 'registered' as const, processingStatus: 'not_processed' as const, name, description: null, sourceUrl: `https://${name}.example`, contentBody: null, category: null, languageHint: null, sourceVersion: 1, lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null, deletedAt: null, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', linkedAssistantCount: 0 });
const tree = () => <MemoryRouter initialEntries={[`/workspace/${mocks.workspace.slug}/knowledge`]}><Routes><Route path="/workspace/:slug/knowledge" element={<KnowledgeBasePage/>}/></Routes></MemoryRouter>;
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.workspace = { slug: 'north', name: 'North Workspace', role: 'owner' }; });

describe('knowledge base workspace UI', () => {
  it('registers a website and shows the honest unprocessed status', async () => {
    mocks.list.mockResolvedValue({ sources: [], total: 0 });
    mocks.website.mockResolvedValue(source('source-1', 'example'));
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: 'Connect your website' }));
    await user.type(screen.getByLabelText('Website URL'), 'https://example.com');
    await user.click(screen.getByRole('button', { name: 'Register website' }));
    expect(await screen.findByText(/Automatic content import is not available yet/)).toBeInTheDocument();
    expect(screen.getByText(/Not processed/)).toBeInTheDocument();
  });

  it('clears sources from the previous workspace and ignores its stale response', async () => {
    let resolveNorth: ((value: { sources: ReturnType<typeof source>[]; total: number }) => void) | undefined;
    mocks.list.mockImplementation((slug: string) => slug === 'north' ? new Promise((resolve) => { resolveNorth = resolve; }) : Promise.resolve({ sources: [source('south', 'south')], total: 1 }));
    const view = render(tree());
    mocks.workspace = { slug: 'south', name: 'South Workspace', role: 'owner' };
    view.rerender(tree());
    expect(await screen.findByText('south')).toBeInTheDocument();
    resolveNorth?.({ sources: [source('north', 'north')], total: 1 });
    expect(screen.queryByText('north')).not.toBeInTheDocument();
  });
});
