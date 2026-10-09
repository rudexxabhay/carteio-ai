export interface HealthResponse { status: 'ok'; service: 'carteio-ai-api'; }
export type ReadinessResponse =
  | { status: 'limited'; database: 'not_configured' }
  | { status: 'ready'; database: 'connected' }
  | { status: 'unavailable'; database: 'unavailable' };
export interface ApiErrorResponse { statusCode: number; code: string; message: string; requestId: string; timestamp: string; path: string; details?: string[]; }
