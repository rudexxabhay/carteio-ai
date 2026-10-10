import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

describe('workspace onboarding', () => {
  it('creates a workspace, remembers its authorized route, and opens the real dashboard', async () => {
    let created = false;
    let createPayload: Record<string, unknown> | undefined;
    const workspace = { id: 'org-1', name: 'Carteio', slug: 'carteio', websiteUrl: null, businessType: null, status: 'active', role: 'owner', currentUserRole: 'owner', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      let body: unknown;
      if (url.endsWith('/auth/me')) body = { user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true, status: 'active' } };
      else if (url.endsWith('/workspaces?page=1&pageSize=100')) body = { workspaces: created ? [workspace] : [], page: 1, pageSize: 100, total: created ? 1 : 0 };
      else if (url.endsWith('/workspaces') && init?.method === 'POST') { created = true; createPayload = JSON.parse(String(init.body)); body = workspace; }
      else if (url.endsWith('/workspaces/carteio')) body = workspace;
      else body = {};
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
    }));

    const user = userEvent.setup();
    window.history.pushState({}, '', '/dashboard');
    render(<App/>);
    expect(await screen.findByRole('heading', { name: 'Create your workspace' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Workspace / Company Name'), 'Carteio');
    expect(screen.getByLabelText('Workspace URL Slug')).toHaveValue('carteio');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    expect(await screen.findByRole('heading', { name: 'Welcome to Carteio' })).toBeInTheDocument();
    expect(createPayload).toEqual({ name: 'Carteio', slug: 'carteio' });
    expect(window.localStorage.getItem('carteio:last-authorized-workspace')).toBe('carteio');
  });

  it('shows duplicate slugs as a field-level error', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true, status: 'active' } }) });
      if (url.endsWith('/workspaces?page=1&pageSize=100')) return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ workspaces: [], page: 1, pageSize: 100, total: 0 }) });
      if (url.endsWith('/workspaces') && init?.method === 'POST') return Promise.resolve({ ok: false, status: 409, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ code: 'WORKSPACE_SLUG_UNAVAILABLE', message: 'That workspace URL is already in use.' }) });
      return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({}) });
    }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/onboarding');
    render(<App/>);
    await screen.findByRole('heading', { name: 'Create your workspace' });
    await user.type(screen.getByLabelText('Workspace / Company Name'), 'Existing Company');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    expect(await screen.findByText('That workspace URL is already in use.')).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace URL Slug')).toHaveAttribute('aria-invalid', 'true');
  });
});
