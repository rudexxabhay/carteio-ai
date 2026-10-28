import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const mocks = vi.hoisted(() => ({
  workspace: { slug: 'north', name: 'North Workspace', role: 'owner' },
  listAssistants: vi.fn(), trainingOverview: vi.fn(), assistantBases: vi.fn(), updateAssistant: vi.fn(),
  listRules: vi.fn(), createRule: vi.fn(), updateRule: vi.fn(), deleteRule: vi.fn(), history: vi.fn(), search: vi.fn(),
  playgroundHistory: vi.fn(), providerStatus: vi.fn(), sendPlaygroundMessage: vi.fn(),
}));
vi.mock('../layouts/DashboardLayout/DashboardLayout', () => ({ useWorkspaceRoute: () => ({ workspace: mocks.workspace }) }));
vi.mock('../services/api/assistants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/assistants')>();
  return {
    ...actual,
    listAssistants: mocks.listAssistants, getAssistantTrainingOverview: mocks.trainingOverview,
    getAssistantKnowledgeBases: mocks.assistantBases, updateAssistant: mocks.updateAssistant,
    listAssistantRules: mocks.listRules, createAssistantRule: mocks.createRule,
    updateAssistantRule: mocks.updateRule, deleteAssistantRule: mocks.deleteRule,
    getAssistantTrainingHistory: mocks.history,
    getPlaygroundConversation: mocks.playgroundHistory,
    getProviderConfigurationStatus: mocks.providerStatus,
    sendPlaygroundMessage: mocks.sendPlaygroundMessage,
  };
});
vi.mock('../services/api/knowledge-bases', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/knowledge-bases')>();
  return { ...actual, getAssistantKnowledgeBases: mocks.assistantBases, replaceAssistantKnowledgeBases: vi.fn() };
});
vi.mock('../services/api/knowledge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api/knowledge')>();
  return { ...actual, previewKnowledgeSearch: mocks.search };
});
import { TrainingCenterPage } from '../pages/training/TrainingCenterPage';

const assistant = { id: 'assistant-a', organizationId: 'org-a', createdById: 'user-a', name: 'Support', description: null, businessPurpose: null, systemInstructions: null, defaultLanguage: 'en', responseTone: 'professional', responseStyle: 'balanced', fallbackMessage: 'Contact support.', greetingMessage: null, escalationMessage: null, status: 'active' as const, createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' };
const base = { id: 'base-a', name: 'Company knowledge', status: 'active', sourceCount: 2 };
const tree = () => <MemoryRouter initialEntries={['/workspace/north/training']}><Routes><Route path="/workspace/:slug/training" element={<TrainingCenterPage/>}/></Routes></MemoryRouter>;
afterEach(() => { cleanup(); vi.resetAllMocks(); mocks.workspace = { slug: 'north', name: 'North Workspace', role: 'owner' }; });
beforeEach(() => {
  mocks.playgroundHistory.mockResolvedValue({ sessionId: 'session-1', messages: [] });
  mocks.providerStatus.mockResolvedValue({
    groq: { keyConfigured: true, status: 'READY_FOR_TESTING' },
    gemini: { keyConfigured: true, status: 'READY_FOR_TESTING', supportedModels: [] },
    openai: { keyConfigured: true, status: 'READY_FOR_TESTING' },
    openrouter: { keyConfigured: true, status: 'READY_FOR_TESTING', modelValidation: null },
    effective: { provider: 'gemini', model: 'gemini-2.5-flash', status: 'READY_FOR_TESTING', configurationValid: true, keyConfigured: true, ready: true },
  });
});

describe('AI Training Center', () => {
  it('keeps the newly selected assistant when an older Bot Behavior save resolves', async () => {
    const other = { ...assistant, id: 'assistant-b', name: 'Other assistant', systemInstructions: 'Second assistant instructions' };
    mocks.listAssistants.mockResolvedValue({ assistants: [assistant, other], page: 1, pageSize: 100, total: 2 });
    mocks.trainingOverview.mockImplementation(async (_slug, id) => ({ assistant: id === other.id ? other : assistant, linkedKnowledgeBaseCount: 0, linkedKnowledgeBases: [], faqCount: 0, textCount: 0, totalKnowledge: 0, readyCount: 0, playgroundReadyCount: 0, processingCount: 0, notIndexedCount: 0, failedCount: 0, attentionCount: 0, activeRuleCount: 0, disabledRuleCount: 0, activeRulesPreview: [], recentActivity: [], behaviorConfigured: true, hasCustomInstructions: true, hasGreeting: false, hasCustomFallback: false }));
    mocks.assistantBases.mockResolvedValue({ linked: [], available: [] });
    let finishSave: ((value: unknown) => void) | undefined;
    mocks.updateAssistant.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const user = userEvent.setup();
    render(tree());
    await user.click(await screen.findByRole('button', { name: 'Bot Behavior' }));
    await user.click(await screen.findByRole('button', { name: 'Save behavior' }));
    await waitFor(() => expect(mocks.updateAssistant).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByLabelText('Select AI assistant'), other.id);
    await waitFor(() => expect(screen.getByLabelText('Display name')).toHaveValue('Other assistant'));
    await act(async () => finishSave?.({ ...assistant, name: 'Saved old assistant' }));
    expect(screen.getByLabelText('Display name')).toHaveValue('Other assistant');
    expect(screen.getByLabelText('How should your assistant communicate?')).toHaveValue('Second assistant instructions');
    expect(screen.queryByText('Behavior settings saved.')).toBeNull();
  });

  it('shows real assistant-linked overview and saves behavior preferences', async () => {
    mocks.listAssistants.mockResolvedValue({ assistants: [assistant], page: 1, pageSize: 100, total: 1 });
    mocks.trainingOverview.mockResolvedValue({ assistant, linkedKnowledgeBaseCount: 1, linkedKnowledgeBases: [base], faqCount: 4, textCount: 1, totalKnowledge: 5, readyCount: 4, playgroundReadyCount: 4, processingCount: 0, notIndexedCount: 0, failedCount: 1, attentionCount: 1, activeRuleCount: 2, disabledRuleCount: 0, activeRulesPreview: [], recentActivity: [], behaviorConfigured: true, hasCustomInstructions: false, hasGreeting: false, hasCustomFallback: false });
    mocks.assistantBases.mockResolvedValue({ linked: [base], available: [] });
    mocks.updateAssistant.mockResolvedValue({ ...assistant, responseTone: 'casual', responseStyle: 'detailed', defaultLanguage: 'ar' });
    const user = userEvent.setup();
    render(tree());
    expect(await screen.findByText('Questions & Answers').then((label) => label.parentElement)).toHaveTextContent('4');
    await user.click(await screen.findByRole('button', { name: 'Knowledge' }));
    expect(await screen.findByText('Company knowledge')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bot Behavior' }));
    const preferredLanguage = await screen.findByLabelText('Preferred language');
    await user.clear(preferredLanguage);
    await user.type(preferredLanguage, 'ar');
    await user.selectOptions(screen.getByLabelText('Tone'), 'casual');
    await user.selectOptions(screen.getByLabelText('Response style'), 'detailed');
    await user.click(screen.getByRole('button', { name: 'Save behavior' }));
    expect(mocks.updateAssistant).toHaveBeenCalledWith('north', 'assistant-a', expect.objectContaining({ defaultLanguage: 'ar', responseTone: 'casual', responseStyle: 'detailed' }));
    expect(await screen.findByText(/future conversation engine/i)).toBeInTheDocument();
  });

  it('opens the shared chat dialog from the compact Playground launcher', async () => {
    mocks.listAssistants.mockResolvedValue({ assistants: [assistant], page: 1, pageSize: 100, total: 1 });
    mocks.trainingOverview.mockResolvedValue({ assistant, linkedKnowledgeBaseCount: 1, linkedKnowledgeBases: [base], faqCount: 1, textCount: 0, totalKnowledge: 1, readyCount: 1, playgroundReadyCount: 1, processingCount: 0, notIndexedCount: 0, failedCount: 0, attentionCount: 0, activeRuleCount: 0, disabledRuleCount: 0, activeRulesPreview: [], recentActivity: [], behaviorConfigured: false, hasCustomInstructions: false, hasGreeting: false, hasCustomFallback: false });
    mocks.assistantBases.mockResolvedValue({ linked: [base], available: [] });
    const user = userEvent.setup(); render(tree());
    await user.click(await screen.findByRole('button', { name: 'Playground' }));
    expect(await screen.findByRole('button', { name: 'Open Chat' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Chat' }));
    expect(await screen.findByRole('dialog', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message your assistant' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
