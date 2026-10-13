import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { runProductionMigrations } from './database/run-production-migrations';
import { resolveCorsOptions } from './config/cors';

async function bootstrap() {
  const corsOptions = resolveCorsOptions();
  runProductionMigrations();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Render forwards client IPs through one trusted proxy hop.
  app.set('trust proxy', 1);

  app.enableCors(corsOptions);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
