import type { HealthResponse } from '@carteio/shared-types';
import { apiGet } from './client';
export type HealthState = {status:'loading'|'connected'|'error'};
export async function getHealth(signal?: AbortSignal): Promise<boolean> { const health=await apiGet<HealthResponse>('/health', signal); return health.status==='ok' && health.service==='carteio-ai-api'; }
