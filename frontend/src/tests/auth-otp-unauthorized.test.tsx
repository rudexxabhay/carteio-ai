import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';

describe('OTP sign-in unauthorized response', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('does not describe an unauthenticated OTP sign-in failure as an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return Promise.resolve({ ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ code: 'UNAUTHORIZED', message: 'Authentication is required' }) });
      if (url.endsWith('/auth/otp/request')) return Promise.resolve({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ deliveryAccepted: true, challengeId: '00000000-0000-4000-8000-000000000009', retryAfterSeconds: 60 }) });
      if (url.endsWith('/auth/otp/verify')) return Promise.resolve({ ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ code: 'ACCOUNT_NOT_FOUND', message: 'Authentication is required' }) });
      return Promise.resolve({ ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ code: 'UNAUTHORIZED', message: 'Authentication is required' }) });
    }));

    const user = userEvent.setup();
    window.history.pushState({}, '', '/login');
    render(<App/>);
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.click(screen.getByRole('button', { name: 'Continue with Email OTP' }));
    await user.type(screen.getByLabelText('Email address'), 'new-user@example.invalid');
    await user.click(screen.getByRole('button', { name: 'Send email code' }));
    await screen.findByText(/check your inbox/i);
    await user.type(screen.getByLabelText('Six-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Account does not exist. Please sign up first.');
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument();
  });
});
