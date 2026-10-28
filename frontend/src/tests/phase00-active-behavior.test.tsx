import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), update: vi.fn() }));
vi.mock('../services/api/assistants', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/api/assistants')>()),
  listAssistants: mocks.list, getAssistant: mocks.get, updateAssistant: mocks.update,
}));
import Pages from '../dashboard-source/pages';
import { ApiError } from '../services/api/client';

let persisted: { id: string; organizationId: string; name: string; status: string; systemInstructions: string; businessPurpose: string; defaultLanguage: string; responseTone: string; responseStyle: string };
const notify = vi.fn();
const show = () => render(<Pages page="behavior" workspaceSlug="north" workspaceRole="owner" preferredAssistantId="assistant-a" go={vi.fn()} notify={notify}/>);
beforeEach(() => {
  vi.resetAllMocks();
  persisted = { id: 'assistant-a', organizationId: 'org-a', name: 'Support', status: 'active', systemInstructions: 'Use authorized evidence.', businessPurpose: 'Customer support', defaultLanguage: 'auto', responseTone: 'professional', responseStyle: 'balanced' };
  mocks.list.mockResolvedValue({ assistants: [persisted], page: 1, pageSize: 25, total: 1 });
  mocks.get.mockImplementation(async () => ({ ...persisted }));
  mocks.update.mockImplementation(async (slug: string, id: string, changes: Record<string, unknown>) => {
    if (slug !== 'north' || id !== 'assistant-a') throw new Error('Wrong workspace or assistant');
    persisted = { ...persisted, ...changes };
    return { ...persisted };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Phase 00 active dashboard Bot Behavior', () => {
  it('saves the selected assistant settings and reloads the persisted values in the actual route component', async () => {
    const user = userEvent.setup();
    show();
    const instructions = await screen.findByLabelText('Business role & instructions');
    await user.clear(instructions); await user.type(instructions, 'Use only authorized facts and follow the customer language.');
    const purpose = screen.getByLabelText('Business purpose');
    await user.clear(purpose); await user.type(purpose, 'Product and policy support');
    const language = screen.getByLabelText('Default language');
    await user.clear(language); await user.type(language, 'hi');
    await user.click(screen.getByRole('button', { name: 'friendly' }));
    await user.click(screen.getByRole('button', { name: 'short' }));
    await user.click(screen.getAllByRole('button', { name: 'Save behavior' })[0]!);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Assistant behavior saved.'));
    expect(mocks.update).toHaveBeenCalledWith('north', 'assistant-a', {
      systemInstructions: 'Use only authorized facts and follow the customer language.', businessPurpose: 'Product and policy support', defaultLanguage: 'hi', responseTone: 'friendly', responseStyle: 'short',
    });
    cleanup(); show();
    expect(await screen.findByLabelText('Business role & instructions')).toHaveValue(persisted.systemInstructions);
    expect(screen.getByLabelText('Business purpose')).toHaveValue('Product and policy support');
    expect(screen.getByLabelText('Default language')).toHaveValue('hi');
    expect(screen.getByRole('button', { name: 'friendly' })).toHaveClass('active');
    expect(screen.getByRole('button', { name: 'short' })).toHaveClass('active');
  });

  it('keeps the draft and reports denied persistence without claiming a successful save', async () => {
    const user = userEvent.setup();
    mocks.update.mockRejectedValueOnce(new ApiError('Permission denied', 'http', 403));
    show();
    const instructions = await screen.findByLabelText('Business role & instructions');
    await user.clear(instructions); await user.type(instructions, 'Unsaved draft');
    await user.click(screen.getAllByRole('button', { name: 'Save behavior' })[0]!);
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(instructions).toHaveValue('Unsaved draft');
    expect(persisted.systemInstructions).toBe('Use authorized evidence.');
    expect(notify).not.toHaveBeenCalled();
  });
});
