import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Workspace } from '../services/api/workspaces';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useWorkspaces: vi.fn(), getWorkspace: vi.fn() }));
vi.mock('../app/providers/AuthProvider', () => ({ useAuth: mocks.useAuth }));
vi.mock('../app/providers/WorkspaceProvider', () => ({ useWorkspaces: mocks.useWorkspaces }));
vi.mock('../services/api/workspaces', () => ({ getWorkspace: mocks.getWorkspace }));
vi.mock('../components/common/ThemeSwitcher', () => ({ ThemeSwitcher: () => null }));

import { DashboardLayout, useWorkspaceRoute } from '../layouts/DashboardLayout/DashboardLayout';

const workspace = (slug: string, name: string): Workspace => ({
  id: slug, name, slug, websiteUrl: null, businessType: null, status: 'active', role: 'owner', currentUserRole: 'owner',
  createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
});

function RouteContent() {
  const { workspace: active } = useWorkspaceRoute();
  return <p data-testid="active-tenant">{active.name} private workspace data</p>;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('workspace switching', () => {
  it('switches only to listed workspaces and clears the previous tenant while the next one loads', async () => {
    const alpha = workspace('alpha-team', 'Alpha');
    const beta = workspace('beta-team', 'Beta');
    const remember = vi.fn();
    mocks.useAuth.mockReturnValue({ user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true }, logout: vi.fn(), googleAuthState: 'READY', setGoogleAuthState: vi.fn() });
    mocks.useWorkspaces.mockReturnValue({ workspaces: [alpha, beta], remember });
    let finishBeta: ((value: Workspace) => void) | undefined;
    mocks.getWorkspace.mockImplementation((slug: string) => slug === 'alpha-team'
      ? Promise.resolve(alpha)
      : new Promise<Workspace>((resolve) => { finishBeta = resolve; }));

    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/workspace/alpha-team']}><Routes><Route path="/workspace/:slug" element={<DashboardLayout/>}><Route index element={<RouteContent/>}/></Route></Routes></MemoryRouter>);
    expect(await screen.findByText('Alpha private workspace data')).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Switch workspace' }), 'beta-team');
    expect(screen.queryByText('Alpha private workspace data')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading workspace');
    finishBeta?.(beta);
    expect(await screen.findByText('Beta private workspace data')).toBeInTheDocument();
    await waitFor(() => expect(remember).toHaveBeenCalledWith('beta-team'));
    expect(mocks.getWorkspace).toHaveBeenCalledWith('beta-team', expect.any(AbortSignal));
  });
});
