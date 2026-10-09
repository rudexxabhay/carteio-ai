import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import request from 'supertest';
import { validateEnvironment } from '../src/config/env.validation';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { requestIdMiddleware } from '../src/common/middleware/request-id.middleware';
import { structuredLoggingMiddleware } from '../src/common/middleware/structured-logging.middleware';

describe('Phase 01 API foundation',()=>{
 let app:INestApplication;
 beforeAll(async()=>{const module=await Test.createTestingModule({imports:[AppModule.register(false)]}).compile();app=module.createNestApplication();app.setGlobalPrefix('api/v1');app.use(requestIdMiddleware);app.use(structuredLoggingMiddleware);app.useGlobalFilters(new AllExceptionsFilter());app.enableCors({origin:['http://localhost:3000'],methods:['GET','OPTIONS'],allowedHeaders:['Content-Type','X-Request-ID']});await app.init();});
 afterAll(async()=>{await app.close();});
 it('returns the health contract',async()=>{await request(app.getHttpServer()).get('/api/v1/health').expect(200).expect({status:'ok',service:'carteio-ai-api'});});
 it('reports the intentional no-database local mode as limited',async()=>{await request(app.getHttpServer()).get('/api/v1/ready').expect(200).expect({status:'limited',database:'not_configured'});});
 it('returns a safe not found response',async()=>{const response=await request(app.getHttpServer()).get('/api/v1/missing').expect(404);expect(response.body).not.toHaveProperty('stack');expect(response.body).not.toHaveProperty('database');});
 it('returns stable machine-readable error codes and the request ID',async()=>{const response=await request(app.getHttpServer()).get('/api/v1/missing').set('X-Request-ID','error-trace').expect(404);expect(response.body).toMatchObject({statusCode:404,code:'NOT_FOUND',message:'Resource not found',requestId:'error-trace'});});
 it('allows only the configured CORS origin',async()=>{const allowed=await request(app.getHttpServer()).get('/api/v1/health').set('Origin','http://localhost:3000').expect(200);expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');const denied=await request(app.getHttpServer()).get('/api/v1/health').set('Origin','https://attacker.example').expect(200);expect(denied.headers['access-control-allow-origin']).toBeUndefined();});
 it('adds a request ID and safely reuses a validated caller ID',async()=>{const response=await request(app.getHttpServer()).get('/api/v1/health').set('X-Request-ID','trace-123').expect(200);expect(response.headers['x-request-id']).toBe('trace-123');const invalid=await request(app.getHttpServer()).get('/api/v1/health').set('X-Request-ID','bad id').expect(200);expect(invalid.headers['x-request-id']).not.toBe('bad id');});
 it('rejects invalid configuration',()=>{expect(()=>validateEnvironment({PORT:'0'})).toThrow();expect(()=>validateEnvironment({API_PREFIX:'v2'})).toThrow();});
});
