import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../app/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function response(body: unknown, status: number) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
}

describe('login page presentation and account errors', () => {
  it('renders Carteio branding, supported login choices, and the centered password sign-in form', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => String(input).endsWith('/auth/me')
      ? response({ code: 'UNAUTHORIZED', message: 'Authentication is required' }, 401)
      : response({}, 200)));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/login');
    const { container } = render(<App/>);

    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Carteio AI home' })).toBeInTheDocument();
    expect(container.querySelector('.auth-login-card')).toBeInTheDocument();
    expect(container.querySelector('.auth-google-mark')).toBeInTheDocument();
    expect(screen.getByText('Please enter your details to sign in.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Remember me' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByRole('button', { name: 'Apple sign-in unavailable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'X sign-in unavailable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with Password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show password' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute('href', '/signup');
    await user.click(screen.getByRole('button', { name: 'Continue with Email OTP' }));
    expect(screen.getByRole('button', { name: 'Send email code' })).toBeInTheDocument();
  });

  it('shows the exact account-not-found message only for its structured response code', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response({ code: 'UNAUTHORIZED', message: 'Authentication is required' }, 401);
      if (url.endsWith('/auth/login')) return response({ code: 'ACCOUNT_NOT_FOUND', message: 'Authentication is required' }, 401);
      return response({}, 200);
    }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/login');
    render(<App/>);
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email address'), 'new-account@example.invalid');
    await user.type(screen.getByLabelText('Password'), 'some-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Account does not exist. Please sign up first.');
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument();
  });

  it('keeps invalid password messaging distinct from account-not-found', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response({ code: 'UNAUTHORIZED', message: 'Authentication is required' }, 401);
      if (url.endsWith('/auth/login')) return response({ code: 'INVALID_CREDENTIALS', message: 'Authentication is required' }, 401);
      return response({}, 200);
    }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/login');
    render(<App/>);
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email address'), 'member@example.invalid');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.queryByText('Account does not exist. Please sign up first.')).not.toBeInTheDocument();
  });

  it('does not label an unclassified login 401 as an expired session', async () => {
    vi.stubGlobal('fetch', vi.fn((input: string) => {
      const url = String(input);
      if (url.endsWith('/auth/me')) return response({ code: 'UNAUTHORIZED', message: 'Authentication is required' }, 401);
      if (url.endsWith('/auth/login')) return response({ code: 'UNAUTHORIZED', message: 'Authentication is required' }, 401);
      return response({}, 200);
    }));
    const user = userEvent.setup();
    window.history.pushState({}, '', '/login');
    render(<App/>);
    await screen.findByRole('heading', { name: 'Welcome back' });
    await user.type(screen.getByLabelText('Email address'), 'member@example.invalid');
    await user.type(screen.getByLabelText('Password'), 'some-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not sign you in. Check your details or contact support.');
    expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Account does not exist. Please sign up first.')).not.toBeInTheDocument();
  });
});
