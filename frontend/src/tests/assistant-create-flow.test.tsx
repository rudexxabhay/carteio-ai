import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));

vi.mock('../services/api/assistants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/assistants')>();
  return { ...actual, listAssistants: mocks.list, createAssistant: mocks.create };
});
vi.mock('../services/api/dashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/dashboard')>();
  return { ...actual, getWorkspaceDashboardSummary: vi.fn().mockResolvedValue({ assistants: { status: 'success', data: { items: [] } } }) };
});

import Pages from '../dashboard-source/pages';

beforeEach(() => {
  mocks.list.mockResolvedValue({ assistants: [], page: 1, pageSize: 100, total: 0 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });

describe('workspace assistant creation route', () => {
  it('uses the backend-supported automatic language default and opens the persisted assistant', async () => {
    const created = { id: 'persisted-assistant-id', name: 'Support assistant' };
    let resolveCreation!: (value: typeof created) => void;
    mocks.create.mockReturnValue(new Promise<typeof created>((resolve) => { resolveCreation = resolve; }));
    const openAssistant = vi.fn();
    const notify = vi.fn();
    const user = userEvent.setup();
    render(<Pages page="assistants" recordId="new" workspaceSlug="authorized-workspace" workspaceRole="owner" go={vi.fn()} notify={notify} openAssistant={openAssistant}/>);

    await user.type(screen.getByLabelText('Name'), 'Support assistant');
    const createButton = screen.getAllByRole('button', { name: 'Create assistant' }).at(-1)!;
    await user.dblClick(createButton);

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledWith('authorized-workspace', {
      name: 'Support assistant', description: '', businessPurpose: '', systemInstructions: '', defaultLanguage: 'auto',
      responseTone: 'professional', responseStyle: 'balanced',
      fallbackMessage: 'I do not have enough authorized information to answer that.', greetingMessage: null, escalationMessage: null,
    });
    resolveCreation(created);
    await waitFor(() => expect(openAssistant).toHaveBeenCalledWith('persisted-assistant-id'));
    expect(notify).toHaveBeenCalledWith('Assistant created.');
  });
});
