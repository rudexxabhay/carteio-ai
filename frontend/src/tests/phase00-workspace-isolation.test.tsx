import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Workspace } from '../services/api/workspaces';

const mocks = vi.hoisted(() => ({ get: vi.fn(), remember: vi.fn() }));
vi.mock('../app/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'owner-a', name: 'Owner' }, logout: vi.fn(), googleAuthState: 'READY', setGoogleAuthState: vi.fn() }) }));
vi.mock('../app/providers/WorkspaceProvider', () => ({ useWorkspaces: () => ({ workspaces: [], remember: mocks.remember }) }));
vi.mock('../app/providers/ThemeProvider', () => ({ useTheme: () => ({ mode: 'light' }) }));
vi.mock('../services/api/workspaces', () => ({ getWorkspace: mocks.get }));
// Keep the actual active route/access loader. Replace only the child dashboard
// presentation so the test can observe which authorized tenant it receives.
vi.mock('../dashboard-source/SourceDashboard', () => ({ default: ({ workspace, onSwitchWorkspace }: { workspace: Workspace; onSwitchWorkspace: (slug: string) => void }) => <section>
  <h1>{workspace.name} private data</h1><p>Role: {workspace.currentUserRole || workspace.role}</p>
  <button onClick={() => onSwitchWorkspace('beta')}>Switch to Beta</button>
</section> }));
import { DashboardLayout } from '../layouts/DashboardLayout/DashboardLayout';
import { ApiError } from '../services/api/client';

const workspace = (slug: string, name: string): Workspace => ({ id: slug, slug, name, role: 'owner', currentUserRole: 'owner', websiteUrl: null, businessType: null, status: 'active', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
const show = () => render(<MemoryRouter initialEntries={['/workspace/alpha']}><Routes><Route path="/workspace/:slug/*" element={<DashboardLayout/>}/></Routes></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Phase 00 active workspace route isolation', () => {
  it('removes the old tenant during authorization of the next workspace and preserves the owner role', async () => {
    let complete!: (value: Workspace) => void;
    mocks.get.mockImplementation((slug: string) => slug === 'alpha' ? Promise.resolve(workspace('alpha', 'Alpha')) : new Promise<Workspace>(resolve => { complete = resolve; }));
    const user = userEvent.setup(); show();
    expect(await screen.findByRole('heading', { name: 'Alpha private data' })).toBeInTheDocument();
    expect(screen.getByText('Role: owner')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    expect(screen.queryByText('Alpha private data')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Preparing your workspace' })).toBeInTheDocument();
    complete(workspace('beta', 'Beta'));
    expect(await screen.findByRole('heading', { name: 'Beta private data' })).toBeInTheDocument();
    expect(screen.queryByText('Alpha private data')).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('beta', expect.any(AbortSignal));
  });

  it('keeps both tenant dashboards hidden when the next workspace denies access', async () => {
    mocks.get.mockImplementation((slug: string) => slug === 'alpha' ? Promise.resolve(workspace('alpha', 'Alpha')) : Promise.reject(new ApiError('Denied', 'http', 403)));
    const user = userEvent.setup(); show();
    await screen.findByRole('heading', { name: 'Alpha private data' });
    await user.click(screen.getByRole('button', { name: 'Switch to Beta' }));
    expect(await screen.findByText('Access could not be verified')).toBeInTheDocument();
    expect(screen.queryByText('Alpha private data')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta private data')).not.toBeInTheDocument();
  });
});
