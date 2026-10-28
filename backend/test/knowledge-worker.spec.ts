import { KnowledgeWorkerModule } from '../src/modules/workspaces/knowledge-worker.module';
import { KnowledgeProcessingService } from '../src/modules/workspaces/knowledge-processing.service';
import { knowledgeWorkerStartupBlockReason } from '../src/knowledge-worker.main';

describe('dedicated knowledge worker bootstrap', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.useRealTimers();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  it('requires explicit standalone enablement and a database URL', () => {
    expect(knowledgeWorkerStartupBlockReason({})).toBe('WORKER_NOT_ENABLED');
    expect(knowledgeWorkerStartupBlockReason({ KNOWLEDGE_WORKER_ENABLED: 'true' })).toBe('STANDALONE_MODE_REQUIRED');
    expect(knowledgeWorkerStartupBlockReason({ KNOWLEDGE_WORKER_ENABLED: 'true', KNOWLEDGE_WORKER_STANDALONE: 'true' })).toBe('DATABASE_CONFIGURATION_MISSING');
    expect(knowledgeWorkerStartupBlockReason({ KNOWLEDGE_WORKER_ENABLED: 'true', KNOWLEDGE_WORKER_STANDALONE: 'true', DATABASE_URL: 'postgresql://worker:fixture@db.example.test/carteio?sslmode=require' })).toBeNull();
  });

  it('refuses startup in Vercel even if the worker flag is accidentally enabled', () => {
    expect(knowledgeWorkerStartupBlockReason({ VERCEL: '1', KNOWLEDGE_WORKER_ENABLED: 'true', KNOWLEDGE_WORKER_STANDALONE: 'true', DATABASE_URL: 'postgresql://worker:fixture@db.example.test/carteio?sslmode=require' })).toBe('SERVERLESS_RUNTIME');
  });

  it('registers only the knowledge processor and its direct service dependencies', () => {
    const providers = Reflect.getMetadata('providers', KnowledgeWorkerModule) as Function[];
    const controllers = Reflect.getMetadata('controllers', KnowledgeWorkerModule) ?? [];
    expect(providers).toEqual([expect.any(Function), expect.any(Function), expect.any(Function)]);
    expect(providers).toContain(KnowledgeProcessingService);
    expect(controllers).toHaveLength(0);
  });

  it('starts one referenced standalone polling timer and stops it cleanly', async () => {
    jest.useFakeTimers();
    process.env.KNOWLEDGE_WORKER_ENABLED = 'true';
    process.env.KNOWLEDGE_WORKER_STANDALONE = 'true';
    delete process.env.VERCEL;
    const worker = new KnowledgeProcessingService({} as any, {} as any, {} as any);

    worker.onModuleInit();
    worker.onModuleInit();
    expect(jest.getTimerCount()).toBe(1);

    await worker.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start polling in Vercel even if the worker flag is true', () => {
    jest.useFakeTimers();
    process.env.KNOWLEDGE_WORKER_ENABLED = 'true';
    process.env.KNOWLEDGE_WORKER_STANDALONE = 'true';
    process.env.VERCEL = '1';
    const worker = new KnowledgeProcessingService({} as any, {} as any, {} as any);

    worker.onModuleInit();
    expect(jest.getTimerCount()).toBe(0);
  });
});
