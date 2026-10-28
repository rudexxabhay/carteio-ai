import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { AuthProvider, useAuth } from '../app/providers/AuthProvider';
import { clearPendingApiGets } from '../services/api/client';

function SessionProbe() {
  const { user, loading } = useAuth();
  return <output>{loading ? 'Checking session' : user?.email ?? 'Signed out'}</output>;
}

afterEach(() => { cleanup(); clearPendingApiGets(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('authenticated dashboard bootstrap', () => {
  it('shares the session bootstrap across StrictMode effect replay', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ user: { id: 'user-1', name: 'Sam', email: 'sam@example.com', emailVerified: true, status: 'active' } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<StrictMode><AuthProvider><SessionProbe/></AuthProvider></StrictMode>);
    expect(await screen.findByText('sam@example.com')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
