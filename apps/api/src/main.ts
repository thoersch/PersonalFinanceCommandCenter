import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  try {
    require('dotenv').config();
  } catch {
    /* dotenv is a dev dependency; Railway injects env vars directly */
  }
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  // The Electron renderer runs from file:// or the Vite dev server; auth is the bearer token.
  app.enableCors({ origin: true, allowedHeaders: ['Authorization', 'Content-Type'] });
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Finance Finder API listening on :${port}`);
}
bootstrap();
