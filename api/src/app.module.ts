import { existsSync } from 'node:fs';

import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppsController } from './apps/apps.controller';
import { AuthController } from './auth/auth.controller';
import { SessionGuard, SessionService } from './auth/session';
import { APP_CONFIG, AppConfig } from './config/app-config';
import { DownloadTokenService } from './downloads/download-token.service';
import { DownloadsController } from './downloads/downloads.controller';
import { ManifestService } from './manifest/manifest.service';
import { StorageService } from './storage/storage.service';
import { SystemsController } from './systems/systems.controller';
import { SystemsService } from './systems/systems.service';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    // Em produção a API também entrega o front (web/dist), num único container.
    const serveWeb = existsSync(config.webDistPath)
      ? [ServeStaticModule.forRoot({ rootPath: config.webDistPath, exclude: ['/api/(.*)', '/d/(.*)'] })]
      : [];

    return {
      module: AppModule,
      imports: [
        JwtModule.register({ secret: config.jwtSecret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: config.loginRateLimitPerMinute }]),
        ...serveWeb,
      ],
      controllers: [SystemsController, AuthController, AppsController, DownloadsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        SystemsService,
        SessionService,
        SessionGuard,
        StorageService,
        ManifestService,
        DownloadTokenService,
      ],
    };
  }
}
