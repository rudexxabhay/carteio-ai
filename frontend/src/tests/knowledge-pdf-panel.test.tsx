import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ capabilities: vi.fn(), upload: vi.fn() }));
vi.mock('../services/api/knowledge', async original => ({ ...(await original<typeof import('../services/api/knowledge')>()), getDocumentCapabilities: mocks.capabilities, uploadKnowledgePdf: mocks.upload }));
import { KnowledgePdfPanel } from '../dashboard-source/KnowledgePdfPanel';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('section PDF upload', () => {
  it('sends the chosen file, persisted section, base and explicit visibility without claiming readiness', async () => {
    mocks.capabilities.mockResolvedValue({ uploadAvailable: true, maxBytes: 10485760, maxPages: 200, workerEnabled: true });
    mocks.upload.mockResolvedValue({ id: 'pdf-1', processingStatus: 'queued' });
    const user = userEvent.setup(), openSource = vi.fn();
    render(<KnowledgePdfPanel slug="north" section="SHIPPING_DELIVERY" bases={[{ id: 'base-1', name: 'Support' } as any]} baseId="base-1" setBaseId={vi.fn()} manager sourceId={null} closeSource={vi.fn()} onChange={vi.fn()} openSource={openSource}/>);
    await waitFor(() => expect(screen.getByRole('button', { name: '+ Upload PDF' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '+ Upload PDF' }));
    const file = new File(['%PDF-1.7 fixture'], 'shipping.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('PDF document'), file);
    await user.click(screen.getByRole('button', { name: 'Upload & Process' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledWith('north', file, { knowledgeBaseId: 'base-1', knowledgeSection: 'SHIPPING_DELIVERY', visibility: 'INTERNAL_RESTRICTED' }, undefined));
    expect(openSource).toHaveBeenCalledWith('pdf-1');
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();
  });
  it('disables upload when backend storage or parser is unavailable', async () => {
    mocks.capabilities.mockResolvedValue({ uploadAvailable: false, blockedReason: 'PRIVATE_STORAGE_UNAVAILABLE' });
    render(<KnowledgePdfPanel slug="north" section="SHIPPING_DELIVERY" bases={[]} baseId="" setBaseId={vi.fn()} manager sourceId={null} closeSource={vi.fn()} onChange={vi.fn()} openSource={vi.fn()}/>);
    expect(await screen.findByText(/PDF setup required: PRIVATE_STORAGE_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Upload PDF' })).toBeDisabled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
