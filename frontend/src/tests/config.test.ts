import { describe, expect, it } from 'vitest';
import { apiConfig } from '../config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
describe('routing configuration',()=>{
 it('keeps browser API configuration same-origin and non-secret',()=>{expect(apiConfig.baseUrl).toBe('/api/v1');expect(apiConfig.baseUrl).not.toContain('localhost');expect(Object.keys(apiConfig)).toEqual(['baseUrl','timeoutMs']);});
 it('proxies the exact API prefix to the single NestJS service',()=>{const config=readFileSync(resolve(process.cwd(),'vite.config.ts'),'utf8');expect(config).toContain("'/api/v1'");expect(config).toContain('http://127.0.0.1:5000');});
 it('keeps nested SPA fallback and API routing separate in production template',()=>{const config=readFileSync(resolve(process.cwd(),'../infrastructure/nginx/ai.carteio.in.conf.template'),'utf8');expect(config).toContain('location ^~ /api/v1/');expect(config).toContain('proxy_pass http://carteio_api;');expect(config).toContain('try_files $uri $uri/ /index.html;');});
});
