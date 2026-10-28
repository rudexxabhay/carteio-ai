import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { performance } from 'node:perf_hooks';

const startupStartedAt = performance.now();
function startupCheckpoint(event: string, startedAt = startupStartedAt, fields: Record<string, unknown> = {}) {
  // Use stdout directly so diagnostics are visible before Nest logging is ready.
  process.stdout.write(`${JSON.stringify({ event, elapsedMs: Math.round(performance.now() - startedAt), ...fields })}\n`);
}

startupCheckpoint('knowledge_worker_startup_entry');

const envFile = resolve(process.cwd(), '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

export function knowledgeWorkerStartupBlockReason(env: Record<string, string | undefined> = process.env): string | null {
  if (env.VERCEL === '1') return 'SERVERLESS_RUNTIME';
  if (env.KNOWLEDGE_WORKER_ENABLED !== 'true') return 'WORKER_NOT_ENABLED';
  if (env.KNOWLEDGE_WORKER_STANDALONE !== 'true') return 'STANDALONE_MODE_REQUIRED';
  if (!env.DATABASE_URL) return 'DATABASE_CONFIGURATION_MISSING';
  try {
    const databaseUrl = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) || !databaseUrl.hostname ||
        !databaseUrl.username || !databaseUrl.password || !databaseUrl.pathname.slice(1) ||
        databaseUrl.searchParams.get('sslmode') !== 'require') return 'DATABASE_CONFIGURATION_INVALID';
  } catch {
    return 'DATABASE_CONFIGURATION_INVALID';
  }
  return null;
}

export async function bootstrapKnowledgeWorker() {
  const logger = new Logger('KnowledgeWorker');
  const diagnosticOnly = process.env.KNOWLEDGE_WORKER_DIAGNOSTIC_ONLY === 'true';
  startupCheckpoint('knowledge_worker_environment_validation_started');
  const blockedReason = knowledgeWorkerStartupBlockReason();
  if (blockedReason) throw new Error(blockedReason);
  startupCheckpoint('knowledge_worker_environment_validated', startupStartedAt, { diagnosticOnly });

  // Load worker dependencies only after local environment variables are read.
  const importStartedAt = performance.now();
  const [{ KnowledgeProcessingService }, { KnowledgeWorkerModule }] = await Promise.all([
    import('./modules/workspaces/knowledge-processing.service'),
    import('./modules/workspaces/knowledge-worker.module'),
  ]);
  startupCheckpoint('knowledge_worker_modules_imported', importStartedAt);

  // This application context intentionally has no HTTP adapter and imports no
  // API, ticket, retention, or connector modules.
  const contextStartedAt = performance.now();
  startupCheckpoint('knowledge_worker_application_context_creation_started');
  // No custom logger is installed in this standalone process. Avoid buffering
  // Nest Logger events indefinitely; worker progress and failure events must
  // reach the terminal after context initialization.
  const app = await NestFactory.createApplicationContext(KnowledgeWorkerModule);
  startupCheckpoint('knowledge_worker_application_context_created', contextStartedAt);
  const resolutionStartedAt = performance.now();
  const worker = app.get(KnowledgeProcessingService);
  startupCheckpoint('knowledge_worker_service_resolved', resolutionStartedAt);
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      logger.log(JSON.stringify({ event: 'knowledge_worker_stopping', signal }));
      await worker.stop();
      await app.close();
      logger.log(JSON.stringify({ event: 'knowledge_worker_stopped', signal }));
    })().catch(() => {
      logger.error(JSON.stringify({ event: 'knowledge_worker_shutdown_failed', reason: 'CLEANUP_FAILED' }));
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  if (diagnosticOnly) {
    startupCheckpoint('knowledge_worker_startup_complete', startupStartedAt, { diagnosticOnly: true, pollingEnabled: false });
    await worker.stop();
    await app.close();
    startupCheckpoint('knowledge_worker_diagnostic_complete', startupStartedAt, { pollingEnabled: false });
  } else {
    logger.log(JSON.stringify({
      event: 'knowledge_worker_started',
      pollIntervalMs: 1500,
      pollingEnabled: true,
      semanticIndexEnabled: process.env.KNOWLEDGE_SEMANTIC_ENABLED === 'true',
      browserRenderingEnabled: process.env.KNOWLEDGE_BROWSER_RENDERING_ENABLED === 'true',
    }));
    startupCheckpoint('knowledge_worker_startup_complete', startupStartedAt, { diagnosticOnly: false, pollingEnabled: true });
  }
  return app;
}

if (require.main === module) {
  void bootstrapKnowledgeWorker().catch((error: unknown) => {
    const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(error.name) ? error.name : 'WorkerStartupError';
    startupCheckpoint('knowledge_worker_start_failed', startupStartedAt, {
      reason: error instanceof Error && /^[A-Z_]{1,64}$/.test(error.message) ? error.message : 'STARTUP_FAILED',
      errorType: errorName,
    });
    process.exitCode = 1;
  });
}
