import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listConfiguredGeminiModel, type GeminiModelDiagnosticEntry } from '../src/modules/workspaces/gemini-model-diagnostic';

export async function runGeminiModelDiagnostic(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch = fetch,
): Promise<GeminiModelDiagnosticEntry[]> {
  if (args.length !== 1 || args[0] !== '--confirm-live') {
    throw new Error('No request sent. Rerun with --confirm-live to call Google Gemini ListModels.');
  }
  if (env.AI_DEFAULT_PROVIDER?.trim().toLowerCase() !== 'gemini') {
    throw new Error('The configured primary provider is not Gemini; no request sent.');
  }
  const model = env.GEMINI_MODEL?.trim();
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!model || !apiKey) throw new Error('GEMINI_MODEL or GEMINI_API_KEY is not configured in the backend environment.');
  return listConfiguredGeminiModel(apiKey, model, fetcher);
}

async function main() {
  if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--confirm-live') {
    process.stderr.write('No live request sent. To call Google ListModels, pass --confirm-live explicitly.\n');
    process.exitCode = 2;
    return;
  }
  try {
    const envFile = resolve(process.cwd(), '.env');
    if (existsSync(envFile)) process.loadEnvFile(envFile);
    const models = await runGeminiModelDiagnostic(process.argv.slice(2), process.env);
    process.stdout.write(`${JSON.stringify(models, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gemini diagnostic failed; provider details suppressed.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
