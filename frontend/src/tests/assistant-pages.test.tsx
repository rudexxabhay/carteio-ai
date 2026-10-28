import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  workspace: { slug: 'north', name: 'North Workspace', role: 'owner' },
  list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), activate: vi.fn(), archive: vi.fn(), restore: vi.fn(), providerStatus: vi.fn(),
}));
vi.mock('../layouts/DashboardLayout/DashboardLayout', () => ({ useWorkspaceRoute: () => ({ workspace: mocks.workspace }) }));
vi.mock('../services/api/assistants', () => ({
  listAssistants: mocks.list, createAssistant: mocks.create, getAssistant: mocks.get,
  updateAssistant: mocks.update, setAssistantActive: mocks.activate,
  archiveAssistant: mocks.archive, restoreAssistant: mocks.restore,
  getProviderConfigurationStatus: mocks.providerStatus,
}));

import { AssistantEditorPage, AssistantListPage } from '../pages/assistants/AssistantPages';

function RouterPath() {
  return <output data-testid="router-path">{useLocation().pathname}</output>;
}

const assistant = (id: string, name: string) => ({
  id, organizationId: mocks.workspace.slug, createdById: 'user-1', name, description: `${name} description`,
  businessPurpose: null, systemInstructions: null, defaultLanguage: 'en', responseTone: 'professional',
  effectiveProviderConfiguration: { provider: 'gemini' as const, model: 'gemini-2.5-flash', status: 'READY_FOR_TESTING' as const, configurationValid: true, keyConfigured: true, ready: true },
  fallbackMessage: 'Contact the business.', status: 'draft' as const, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
});

afterEach(() => {
  cleanup(); vi.resetAllMocks();
  mocks.providerStatus.mockResolvedValue({ groq: { keyConfigured: true, status: 'READY_FOR_TESTING' }, gemini: { keyConfigured: true, status: 'READY_FOR_TESTING', supportedModels: [] }, openai: { keyConfigured: true, status: 'READY_FOR_TESTING' }, openrouter: { keyConfigured: true, status: 'READY_FOR_TESTING', modelValidation: null }, effective: { provider: 'gemini', model: 'gemini-2.5-flash', status: 'READY_FOR_TESTING', configurationValid: true, keyConfigured: true, ready: true } });
  mocks.workspace = { slug: 'north', name: 'North Workspace', role: 'owner' };
});

describe('assistant workspace UI', () => {
  it('creates through the API and opens the persisted assistant detail route', async () => {
    const created = assistant('assistant-1', 'Support Assistant');
    mocks.providerStatus.mockResolvedValue({ groq: { keyConfigured: true, status: 'READY_FOR_TESTING' }, gemini: { keyConfigured: true, status: 'READY_FOR_TESTING', supportedModels: [] }, openai: { keyConfigured: true, status: 'READY_FOR_TESTING' }, openrouter: { keyConfigured: true, status: 'READY_FOR_TESTING', modelValidation: null }, effective: created.effectiveProviderConfiguration });
    mocks.create.mockResolvedValue(created);
    mocks.get.mockResolvedValue(created);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workspace/north/assistants/new']}><Routes>
      <Route path="/workspace/:slug/assistants/new" element={<AssistantEditorPage/>}/>
      <Route path="/workspace/:slug/assistants/:assistantId" element={<AssistantEditorPage/>}/>
    </Routes><RouterPath/></MemoryRouter>);
    await user.type(screen.getByLabelText('Assistant name'), 'Support Assistant');
    await user.click(screen.getByRole('button', { name: 'Create assistant' }));
    expect(await screen.findByRole('heading', { name: 'Support Assistant' })).toBeInTheDocument();
    expect(screen.queryByText('Enter a valid language tag, such as en or en-US.')).not.toBeInTheDocument();
    expect(screen.getByTestId('router-path')).toHaveTextContent('/workspace/north/assistants/assistant-1');
    expect(mocks.create).toHaveBeenCalledWith('north', expect.objectContaining({ name: 'Support Assistant', defaultLanguage: 'auto' }));
  });

  it('clears previous workspace assistants and ignores their stale response after switching', async () => {
    let resolveNorth: ((value: { assistants: ReturnType<typeof assistant>[]; page: number; pageSize: number; total: number }) => void) | undefined;
    mocks.list.mockImplementation((slug: string) => slug === 'north'
      ? new Promise((resolve) => { resolveNorth = resolve; })
      : Promise.resolve({ assistants: [assistant('assistant-south', 'South Helper')], page: 1, pageSize: 100, total: 1 }));
    const tree = () => <MemoryRouter initialEntries={['/workspace/north/assistants']}><Routes><Route path="/workspace/:slug/assistants" element={<AssistantListPage/>}/></Routes></MemoryRouter>;
    const view = render(tree());
    expect(screen.getByRole('status')).toHaveTextContent('Loading assistants');
    mocks.workspace = { slug: 'south', name: 'South Workspace', role: 'owner' };
    view.rerender(tree());
    expect(await screen.findByText('South Helper')).toBeInTheDocument();
    resolveNorth?.({ assistants: [assistant('assistant-north', 'North Private Assistant')], page: 1, pageSize: 100, total: 1 });
    expect(screen.queryByText('North Private Assistant')).not.toBeInTheDocument();
  });

  it('requires confirmation before restoring an archived assistant and leaves activation explicit', async () => {
    const archived = { ...assistant('assistant-archived', 'Archived Helper'), status: 'archived' as const, archivedAt: '2026-10-12T10:00:00.000Z' };
    const restored = { ...archived, status: 'inactive' as const, archivedAt: null };
    mocks.get.mockResolvedValue(archived);
    mocks.restore.mockResolvedValue(restored);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workspace/north/assistants/assistant-archived']}><Routes>
      <Route path="/workspace/:slug/assistants/:assistantId" element={<AssistantEditorPage/>}/>
    </Routes></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Restore assistant' }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('remains inactive');
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Restore assistant' }));
    expect(await screen.findByText(/Permanent deletion is unavailable/)).toBeInTheDocument();
    expect(mocks.restore).toHaveBeenCalledWith('north', 'assistant-archived');
    expect(screen.getByRole('button', { name: 'Activate' })).toBeInTheDocument();
  });
});
