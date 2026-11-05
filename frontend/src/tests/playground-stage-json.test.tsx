import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlaygroundStageJsonList } from '../dashboard-source/pages';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Playground stage JSON console', () => {
  it('renders actual stage outcomes, nested structured data, and first failure separately', () => {
    const { container } = render(<PlaygroundStageJsonList events={[
      { operation: 'INTENT_INTERPRETATION', outcome: 'COMPLETED', durationMs: 24, input: { message: { fingerprint: 'safe' } }, output: { accepted: true } },
      { operation: 'KNOWLEDGE_RETRIEVAL', outcome: 'SKIPPED', reason: 'assistant_capability_response' },
      { operation: 'ANSWER_GENERATION', outcome: 'FAILED', errorCategory: 'PROVIDER_TIMEOUT', reason: 'provider_call_failed' },
    ]}/>);

    expect(screen.getByText('INTENT_INTERPRETATION')).toBeInTheDocument();
    expect(screen.getByText('KNOWLEDGE_RETRIEVAL')).toBeInTheDocument();
    expect(screen.getByText('SKIPPED')).toBeInTheDocument();
    expect(screen.getByText('ANSWER_GENERATION')).toBeInTheDocument();
    expect(container.querySelector('.dev-console-stage.is-first-failure')).toHaveTextContent('ANSWER_GENERATION');
    expect(screen.getByText('message')).toBeInTheDocument();
  });

  it('copies the exact stage JSON and reports clipboard success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const stage = { operation: 'SESSION_RESOLUTION', outcome: 'COMPLETED', durationMs: 5, output: { resolved: true } };
    render(<PlaygroundStageJsonList events={[stage]}/>);

    fireEvent.click(screen.getByRole('button', { name: 'Copy stage JSON' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(stage, null, 2)));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
  });

  it('states when detailed history was not recorded instead of fabricating stages', () => {
    render(<PlaygroundStageJsonList events={[]}/>);
    expect(screen.getByText('Detailed trace not recorded.')).toBeInTheDocument();
    expect(screen.queryByText('SESSION_RESOLUTION')).not.toBeInTheDocument();
  });
});
