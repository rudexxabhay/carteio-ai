import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ workspace: { slug: 'north', name: 'North Workspace', role: 'owner' }, list: vi.fn(), listUnassigned: vi.fn(), addSources: vi.fn(), create: vi.fn(), archive: vi.fn() }));
vi.mock('../layouts/DashboardLayout/DashboardLayout', () => ({ useWorkspaceRoute: () => ({ workspace: mocks.workspace }) }));
vi.mock('../services/api/knowledge-bases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/knowledge-bases')>();
  return { ...actual, listKnowledgeBases: mocks.list, listUnassignedKnowledgeSources: mocks.listUnassigned, addKnowledgeBaseSources: mocks.addSources, createKnowledgeBase: mocks.create, archiveKnowledgeBase: mocks.archive };
});
import { KnowledgeBasePage } from '../pages/knowledge/KnowledgeBasePage';

const base = { id: 'base-a', organizationId: 'org-a', createdById: 'user-a', name: 'Company Information', description: 'Policies and services', status: 'active' as const, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z', archivedAt: null, sourceCount: 4, linkedAssistantCount: 2 };
const page = { knowledgeBases: [base], total: 1, page: 1, pageSize: 20, summary: { totalKnowledgeBases: 1, totalSources: 4, unassignedSources: 2, linkedAssistants: 2 } };
const unassignedPage = { sources: [{ id: 'source-a', organizationId: 'org-a', createdById: 'user-a', type: 'text' as const, status: 'registered' as const, processingStatus: 'ready' as const, name: 'Support policy', description: null, sourceUrl: null, contentBody: 'Returns are accepted within seven days.', category: null, languageHint: null, sourceVersion: 1, lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null, deletedAt: null, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' }], total: 1, page: 1, pageSize: 20 };
const tree = () => <MemoryRouter initialEntries={[`/workspace/${mocks.workspace.slug}/knowledge`]}><Routes><Route path="/workspace/:slug/knowledge" element={<KnowledgeBasePage/>}/><Route path="/workspace/:slug/knowledge/:baseId" element={<p>Base detail</p>}/></Routes></MemoryRouter>;
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.workspace = { slug: 'north', name: 'North Workspace', role: 'owner' }; });

describe('Knowledge Base collection dashboard', () => {
  it('shows API counts and server-side collection records', async () => {
    mocks.list.mockResolvedValue(page);
    render(tree());
    expect(await screen.findByText('Company Information')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/4 sources · 2 assistants/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage assignments' })).toHaveAttribute('href', '/workspace/north/knowledge/base-a?tab=assistants');
  });

  it('creates a collection and navigates to its detail route', async () => {
    mocks.list.mockResolvedValue(page);
    mocks.create.mockResolvedValue(base);
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: /Create Knowledge Base/ }));
    await user.type(screen.getByLabelText('Name'), 'Support');
    await user.click(screen.getByRole('button', { name: /Create and open/ }));
    expect(await screen.findByText('Base detail')).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith('north', { name: 'Support' });
  });

  it('shows source details and explicitly assigns the existing source without replacing its record', async () => {
    mocks.list.mockResolvedValue(page);
    mocks.listUnassigned.mockResolvedValue(unassignedPage);
    mocks.addSources.mockResolvedValue({ requested: 1, added: 1, alreadyPresent: 0, restrictedVisibility: 1, processingBlocked: 1, failedProcessing: 1, statusBlocked: 0 });
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('tab', { name: /Unassigned Sources/ }));
    expect(await screen.findByText('Support policy')).toBeInTheDocument();
    await user.click(screen.getByText('View source details'));
    expect(screen.getByText('Returns are accepted within seven days.')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Select Support policy' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Destination Knowledge Base' }), 'base-a');
    await user.click(screen.getByRole('button', { name: 'Assign selected' }));
    expect(mocks.addSources).toHaveBeenCalledWith('north', 'base-a', ['source-a']);
  });

  it('makes website sources discoverable in the unassigned-source filter', async () => {
    mocks.list.mockResolvedValue(page);
    mocks.listUnassigned.mockResolvedValue({ ...unassignedPage, sources: [] });
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('tab', { name: /Unassigned Sources/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'website');
    expect(mocks.listUnassigned).toHaveBeenLastCalledWith('north', expect.objectContaining({ type: 'WEBSITE' }), expect.anything());
  });
});
