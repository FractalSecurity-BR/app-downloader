import 'reflect-metadata';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { AppConfig, loadConfig } from './config/app-config';

export function configureApp(app: NestExpressApplication, config: AppConfig) {
  // Atrás de load balancer/proxy, para o rate limit enxergar o IP real do cliente.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        },
      },
    }),
  );
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
  // Autenticação é por header Bearer (sem cookies), então não há credentials no CORS.
  app.enableCors({ origin: config.corsOrigins, methods: ['GET', 'POST', 'OPTIONS'] });
}

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
  Logger.log(`Portal de Aplicativos em ${config.publicUrl} (storage=${config.storage.driver})`, 'Bootstrap');
}

if (require.main === module) void bootstrap();
