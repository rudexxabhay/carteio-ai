import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from '../components/common/AppErrorBoundary';
import { ErrorState, LoadingState, NotFoundState } from '../components/common/ErrorStates';

describe('shared Carteio error states', () => {
  it('distinguishes initial loading from a successfully empty result', () => {
    const { rerender } = render(<LoadingState label="Loading integrations" skeleton/>);
    expect(screen.getByRole('status', { name: 'Loading integrations' })).toHaveAttribute('aria-busy', 'true');
    rerender(<ErrorState title="No integrations" message="No connectors were returned."/>);
    expect(screen.getByRole('alert')).toHaveTextContent('No integrations');
  });

  it('runs the requested retry action', () => {
    const retry = vi.fn();
    render(<ErrorState title="Network unavailable" message="Try again." action={{ label: 'Retry', onClick: retry }} icon="network"/>);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('contains dashboard render crashes and retries without replacing the dashboard shell', () => {
    let shouldThrow = true;
    function RecoverablePage() {
      if (shouldThrow) throw new Error('openShopify is not defined');
      return <p>Recovered dashboard section</p>;
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<><header>Carteio dashboard shell</header><button type="button" onClick={() => { shouldThrow = false; }}>Repair dashboard section</button><AppErrorBoundary mode="section"><RecoverablePage/></AppErrorBoundary></>);
    expect(screen.getByText('Carteio dashboard shell')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('This dashboard section couldn’t load');
    fireEvent.click(screen.getByRole('button', { name: 'Repair dashboard section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Recovered dashboard section')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('offers a safe home action for an unknown route', () => {
    const onHome = vi.fn();
    render(<NotFoundState onHome={onHome}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(onHome).toHaveBeenCalledOnce();
  });
});
