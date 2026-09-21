import { Controller, Get, HttpCode, HttpStatus, Logger, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentSession, PortalSession, SessionGuard } from '../auth/session';
import { DownloadTokenService } from '../downloads/download-token.service';
import { ManifestService, ManifestVersion } from '../manifest/manifest.service';
import { ENVIRONMENT_NAMES } from '../systems/systems.service';
import { findVisibleVersion, visibleApps } from './visibility';

function toView(v: ManifestVersion) {
  return {
    version: v.version,
    build: v.build ?? null,
    releaseNotes: v.releaseNotes ?? '',
    sizeBytes: v.sizeBytes ?? null,
    publishedAt: v.createdAt,
  };
}

@Controller('api/apps')
@UseGuards(SessionGuard)
export class AppsController {
  private readonly logger = new Logger(AppsController.name);

  constructor(
    private readonly manifests: ManifestService,
    private readonly downloadTokens: DownloadTokenService,
  ) {}

  @Get()
  async list(@CurrentSession() session: PortalSession) {
    const manifest = await this.manifests.get(session.systemId);
    return {
      apps: visibleApps(manifest, session).map(({ app, channels }) => ({
        id: app.id,
        name: app.name,
        description: app.description ?? '',
        channels: channels.map(({ environment, current, previous }) => ({
          environment: { id: environment, name: ENVIRONMENT_NAMES[environment] },
          current: toView(current),
          previous: previous.map(toView),
        })),
      })),
    };
  }

  @Post(':appId/versions/:version/link')
  @HttpCode(HttpStatus.OK)
  async link(@CurrentSession() session: PortalSession, @Param('appId') appId: string, @Param('version') version: string) {
    const found = findVisibleVersion(await this.manifests.get(session.systemId), session, appId, version);
    if (!found) throw new NotFoundException({ code: 'APP_NOT_FOUND', message: 'App ou versão indisponível' });

    const link = await this.downloadTokens.issue(session, appId, version, found.environment);
    this.logger.log(`link gerado user=${session.username} system=${session.systemId} env=${found.environment} app=${appId} version=${version}`);
    return link;
  }
}
