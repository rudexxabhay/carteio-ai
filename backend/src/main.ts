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

const localEnvironmentFile = resolve(process.cwd(), '.env');
if (existsSync(localEnvironmentFile)) process.loadEnvFile(localEnvironmentFile);

async function bootstrap() {
  let config: AppEnvironment;
  try {
    config=validateEnvironment(process.env as Record<string,unknown>);
  } catch (error: unknown) {
    new Logger('Configuration').error(error instanceof Error ? error.message : 'Environment configuration is invalid');
    process.exitCode=1;
    return;
  }
  const availableLevels: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const app=await NestFactory.create(AppModule.register(config.DATABASE_ENABLED),{bodyParser:false,bufferLogs:true,logger:availableLevels.slice(0,availableLevels.indexOf(config.LOG_LEVEL)+1)});
  app.getHttpAdapter().getInstance().set('trust proxy', config.TRUST_PROXY_HOPS);
  app.use(helmet({crossOriginResourcePolicy:{policy:'same-site'}}));
  app.use(requestIdMiddleware);
  app.use(structuredLoggingMiddleware);
  app.use(express.json({limit:'1mb'}));
  app.use(express.urlencoded({extended:false,limit:'1mb'}));
  app.use(bodyParserErrorMiddleware);
  app.use('/api/v1/auth', csrfOriginMiddleware(config.CORS_ALLOWED_ORIGINS.split(',').map(value => value.trim())));
  app.use('/api/v1/workspaces', csrfOriginMiddleware(config.CORS_ALLOWED_ORIGINS.split(',').map(value => value.trim())));
  app.setGlobalPrefix(config.API_PREFIX);
  app.enableCors({origin:config.CORS_ALLOWED_ORIGINS.split(',').map(value=>value.trim()),methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],allowedHeaders:['Content-Type','X-Request-ID'],exposedHeaders:['X-Request-ID'],credentials:true,maxAge:600});
  app.useGlobalPipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true,transformOptions:{enableImplicitConversion:false}}));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
  await app.listen(config.PORT,config.HOST);
  new Logger('Bootstrap').log(`Carteio AI API listening on port ${config.PORT}`);
}
bootstrap().catch(()=>{new Logger('Bootstrap').error('API startup failed: configuration or server initialization error');process.exitCode=1;});
