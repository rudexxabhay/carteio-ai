import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  workspace: { slug: 'north', name: 'North Workspace', role: 'owner' },
  list: vi.fn(), create: vi.fn(), get: vi.fn(), update: vi.fn(), activate: vi.fn(),
}));
vi.mock('../layouts/DashboardLayout/DashboardLayout', () => ({ useWorkspaceRoute: () => ({ workspace: mocks.workspace }) }));
vi.mock('../services/api/assistants', () => ({
  listAssistants: mocks.list, createAssistant: mocks.create, getAssistant: mocks.get,
  updateAssistant: mocks.update, setAssistantActive: mocks.activate,
}));

import { AssistantEditorPage, AssistantListPage } from '../pages/assistants/AssistantPages';

const assistant = (id: string, name: string) => ({
  id, organizationId: mocks.workspace.slug, createdById: 'user-1', name, description: `${name} description`,
  businessPurpose: null, systemInstructions: null, defaultLanguage: 'en', responseTone: 'professional',
  fallbackMessage: 'Contact the business.', status: 'draft' as const, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
});

afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.workspace = { slug: 'north', name: 'North Workspace', role: 'owner' }; });

describe('assistant workspace UI', () => {
  it('creates through the API and opens the persisted assistant detail route', async () => {
    const created = assistant('assistant-1', 'Support Assistant');
    mocks.create.mockResolvedValue(created);
    mocks.get.mockResolvedValue(created);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workspace/north/assistants/new']}><Routes>
      <Route path="/workspace/:slug/assistants/new" element={<AssistantEditorPage/>}/>
      <Route path="/workspace/:slug/assistants/:assistantId" element={<AssistantEditorPage/>}/>
    </Routes></MemoryRouter>);
    await user.type(screen.getByLabelText('Assistant name'), 'Support Assistant');
    await user.click(screen.getByRole('button', { name: 'Create assistant' }));
    expect(await screen.findByRole('heading', { name: 'Support Assistant' })).toBeInTheDocument();
    expect(mocks.create).toHaveBeenCalledWith('north', expect.objectContaining({ name: 'Support Assistant', defaultLanguage: 'en' }));
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
});
