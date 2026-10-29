import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger, ValidationPipe, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import express from 'express';
import { AppModule } from './app.module';
import { validateEnvironment, type AppEnvironment } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { structuredLoggingMiddleware } from './common/middleware/structured-logging.middleware';
import { bodyParserErrorMiddleware } from './common/middleware/body-parser-error.middleware';
import { csrfOriginMiddleware } from './common/middleware/csrf-origin.middleware';
import { initializeEffectiveProviderConfiguration } from './modules/workspaces/conversation-provider.service';
import { PrismaService } from './infrastructure/database/prisma.service';
import { currentWidgetOriginPolicyCacheRevision, normalizeWidgetOrigin, widgetOriginMatchesDomains } from './modules/workspaces/widget-origin';

const localEnvironmentFile = resolve(process.cwd(), '.env');
if (existsSync(localEnvironmentFile)) process.loadEnvFile(localEnvironmentFile);

async function bootstrap() {
  let config: AppEnvironment;
  try {
    config=validateEnvironment(process.env as Record<string,unknown>);
  } catch (error: unknown) {
    if (process.env.VERCEL === '1' && process.env.NODE_ENV === 'production'
      && (process.env.PUBLIC_APP_URL === 'https://uat.ai.carteio.in' || process.env.VERCEL_PROJECT_PRODUCTION_URL === 'carteio-ai-uat-backend.vercel.app')) {
      new Logger('Configuration').error(JSON.stringify({event:'uat_backend_startup_failure',requestId:'unavailable_before_request',operation:'bootstrap',stage:'environment_validation',exceptionClass:'Error',causeCategory:'ENV_CONFIG'}));
    }
    new Logger('Configuration').error(error instanceof Error ? error.message : 'Environment configuration is invalid');
    process.exitCode=1;
    return;
  }
  initializeEffectiveProviderConfiguration({
    AI_DEFAULT_PROVIDER: config.AI_DEFAULT_PROVIDER,
    GROQ_MODEL: config.GROQ_MODEL,
    GEMINI_MODEL: config.GEMINI_MODEL,
    OPENAI_MODEL: config.OPENAI_MODEL,
    OPENROUTER_MODEL: config.OPENROUTER_MODEL,
    OPENROUTER_BASE_URL: config.OPENROUTER_BASE_URL,
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  });
  const availableLevels: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const app=await NestFactory.create(AppModule.register(config.DATABASE_ENABLED),{bodyParser:false,bufferLogs:true,logger:availableLevels.slice(0,availableLevels.indexOf(config.LOG_LEVEL)+1)});
  app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}}));
  app.use(requestIdMiddleware);
  app.use(structuredLoggingMiddleware);
  app.setGlobalPrefix(config.API_PREFIX);
  const dashboardOrigins=config.CORS_ALLOWED_ORIGINS.split(',').map(value=>value.trim());
  const widgetCorsLogger=new Logger('WidgetCORS');
  const widgetDb = config.DATABASE_ENABLED ? app.get(PrismaService, { strict: false }) : null;
  let widgetCorsDomains: unknown[] = [];
  let widgetCorsEnabledConfigurationCount = 0;
  let widgetCorsAllowedDomainsArrayCount = 0;
  let widgetCorsDomainEntryCount = 0;
  let widgetCorsStringDomainEntryCount = 0;
  let widgetCorsLookupFailed = false;
  let widgetCorsDomainsExpireAt = 0;
  let widgetCorsCacheRevision = currentWidgetOriginPolicyCacheRevision();
  let widgetCorsRefresh: Promise<void> | null = null;
  app.enableCors((request, callback) => {
    const corsStartedAt=Date.now();
    const isWidget=(request.path ?? '').startsWith('/api/v1/widgets/');
    if (!isWidget) {
      callback(null,{origin:dashboardOrigins,methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-Request-ID','Authorization'],exposedHeaders:['X-Request-ID','Retry-After'],credentials:true,maxAge:600});
      return;
    }
    const rawOrigin = request.headers.origin;
    if (!widgetDb || typeof rawOrigin !== 'string') {
      const response=(request as typeof request&{res?:import('express').Response}).res;
      const reason = !widgetDb ? 'DATABASE_LOOKUP_FAILED' : 'INVALID_ORIGIN';
      if(config.WIDGET_DEBUG_ENABLED&&response)response.once('finish',()=>widgetCorsLogger.log(JSON.stringify({event:'widget_debug',stage:'W04_origin_domain_authorization',operation:'widget.cors.origin_policy',requestId:(request as typeof request&{requestId?:string}).requestId??'unknown',durationMs:Date.now()-corsStartedAt,status:'failure',httpStatus:response.statusCode,corsAllowOriginPresent:typeof response.getHeader('Access-Control-Allow-Origin')==='string',failureCategory:reason,databaseConfigured:config.DATABASE_ENABLED})));
      widgetCorsLogger.warn(JSON.stringify({event:'widget_cors_request_rejected',requestId:(request as typeof request&{requestId?:string}).requestId??'unknown',operation:'widget.cors.preflight_or_request',reason,method:request.method}));
      callback(null,{origin:false,methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-Request-ID','Authorization','ngrok-skip-browser-warning'],exposedHeaders:['X-Request-ID','Retry-After'],credentials:false,maxAge:600});
      return;
    }
    const respond = (allowed: boolean,reason?:string) => {
      const response=(request as typeof request&{res?:import('express').Response}).res;
      if(config.WIDGET_DEBUG_ENABLED&&response)response.once('finish',()=>widgetCorsLogger.log(JSON.stringify({event:'widget_debug',stage:'W04_origin_domain_authorization',operation:'widget.cors.origin_policy',requestId:(request as typeof request&{requestId?:string}).requestId??'unknown',durationMs:Date.now()-corsStartedAt,status:allowed?'success':'failure',httpStatus:response.statusCode,corsAllowOriginPresent:typeof response.getHeader('Access-Control-Allow-Origin')==='string',failureCategory:allowed?undefined:reason??'DOMAIN_NOT_MATCHED',databaseConfigured:config.DATABASE_ENABLED,enabledConfigurationCount:widgetCorsEnabledConfigurationCount})));
      if(!allowed)widgetCorsLogger.warn(JSON.stringify({event:'widget_cors_request_rejected',requestId:(request as typeof request&{requestId?:string}).requestId??'unknown',operation:'widget.cors.preflight_or_request',reason:allowed?undefined:reason??'DOMAIN_NOT_MATCHED',method:request.method}));
      callback(null,{origin:allowed?rawOrigin:false,methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-Request-ID','Authorization','ngrok-skip-browser-warning'],exposedHeaders:['X-Request-ID','Retry-After'],credentials:false,maxAge:600});
    };
    void (async () => {
      try {
        const origin = normalizeWidgetOrigin(rawOrigin);
        const currentPolicyRevision=currentWidgetOriginPolicyCacheRevision();
        if(currentPolicyRevision!==widgetCorsCacheRevision){widgetCorsDomainsExpireAt=0;widgetCorsCacheRevision=currentPolicyRevision;}
        if (Date.now() >= widgetCorsDomainsExpireAt) {
          if (!widgetCorsRefresh) {
            widgetCorsRefresh = widgetDb.widgetConfiguration.findMany({where:{enabled:true},select:{allowedDomains:true}})
              .then((configurations: Array<{ allowedDomains: unknown }>) => {
                widgetCorsEnabledConfigurationCount=configurations.length;
                widgetCorsAllowedDomainsArrayCount=configurations.filter((configuration) => Array.isArray(configuration.allowedDomains)).length;
                widgetCorsDomains=configurations.flatMap((configuration) => Array.isArray(configuration.allowedDomains) ? configuration.allowedDomains : []);
                widgetCorsDomainEntryCount=widgetCorsDomains.length;
                widgetCorsStringDomainEntryCount=widgetCorsDomains.filter((domain) => typeof domain === 'string').length;
                widgetCorsLookupFailed=false;
                widgetCorsDomainsExpireAt=Date.now()+30_000;
              })
              .catch(() => { widgetCorsLogger.error(JSON.stringify({event:'widget_cors_policy_lookup_failed',requestId:(request as typeof request&{requestId?:string}).requestId??'unknown',operation:'widget.cors.policy_lookup',failureCategory:'DATABASE_LOOKUP_FAILED'})); widgetCorsDomains=[]; widgetCorsEnabledConfigurationCount=0; widgetCorsLookupFailed=true; widgetCorsDomainsExpireAt=Date.now()+5_000; })
              .finally(() => { widgetCorsRefresh=null; });
          }
          await widgetCorsRefresh;
        }
        if(widgetCorsLookupFailed) respond(false,'DATABASE_LOOKUP_FAILED');
        else if(widgetCorsEnabledConfigurationCount===0) respond(false,'NO_ENABLED_WIDGET');
        else {
          const allowed=widgetOriginMatchesDomains(origin, widgetCorsDomains);
          if(config.WIDGET_DEBUG_ENABLED)widgetCorsLogger.log(JSON.stringify({event:'widget_cors_domain_match_evaluated',stage:'W04_origin_domain_authorization',requestId:(request as typeof request&{requestId?:string}).requestId??'unknown',implementation:'flat-widget-domains-v1',configurationCount:widgetCorsEnabledConfigurationCount,allowedDomainsIsArray:widgetCorsAllowedDomainsArrayCount===widgetCorsEnabledConfigurationCount,allowedDomainsArrayCount:widgetCorsAllowedDomainsArrayCount,domainEntryCount:widgetCorsDomainEntryCount,stringDomainEntryCount:widgetCorsStringDomainEntryCount,matcherInputTypes:{origin:typeof origin,domains:Array.isArray(widgetCorsDomains)?'array':typeof widgetCorsDomains,firstDomainEntry:widgetCorsDomains.length?typeof widgetCorsDomains[0]:'none'},targetHostnameMatches:allowed,authorizationResult:allowed?'authorized':'rejected'}));
          respond(allowed,allowed?undefined:'DOMAIN_NOT_MATCHED');
        }
      } catch {
        respond(false,'INVALID_ORIGIN');
      }
    })();
  });
  // CORS must run before body parsing so parser rejections on authorized widget POSTs
  // still carry the approved origin headers back to the browser.
  app.use(express.json({limit:'1mb',verify:(request:any,_response,buffer)=>{if(String(request.originalUrl??request.url).startsWith('/api/v1/connectors/webhooks/'))request.rawBody=Buffer.from(buffer)}}));
  app.use(express.urlencoded({extended:false,limit:'1mb'}));
  app.use(bodyParserErrorMiddleware);
  app.use('/api/v1/auth', csrfOriginMiddleware(config.CORS_ALLOWED_ORIGINS.split(',').map(value => value.trim())));
  app.use('/api/v1/workspaces', csrfOriginMiddleware(config.CORS_ALLOWED_ORIGINS.split(',').map(value => value.trim())));
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,transformOptions:{enableImplicitConversion:false}}));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen(config.PORT,config.HOST);
  new Logger('Bootstrap').log(`Carteio AI API listening on port ${config.PORT}`);
}
bootstrap().catch((error: unknown)=>{
  if (process.env.VERCEL === '1' && process.env.NODE_ENV === 'production'
    && (process.env.PUBLIC_APP_URL === 'https://uat.ai.carteio.in' || process.env.VERCEL_PROJECT_PRODUCTION_URL === 'carteio-ai-uat-backend.vercel.app')) {
    const candidate = typeof error === 'object' && error !== null ? error as {name?: unknown;code?: unknown} : null;
    const exceptionClass = typeof candidate?.name === 'string' && ['PrismaClientInitializationError','PrismaClientKnownRequestError','TypeError','Error'].includes(candidate.name) ? candidate.name : 'OTHER';
    const prismaCode = typeof candidate?.code === 'string' && /^P\d{4}$/u.test(candidate.code) ? candidate.code : undefined;
    new Logger('Bootstrap').error(JSON.stringify({event:'uat_backend_startup_failure',requestId:'unavailable_before_request',operation:'bootstrap',stage:'app_initialization',exceptionClass,causeCategory:exceptionClass.startsWith('Prisma')?'DB_INITIALIZATION':'INITIALIZATION',...(prismaCode?{prismaCode}:{})}));
  }
  new Logger('Bootstrap').error('API startup failed: configuration or server initialization error');process.exitCode=1;
});
