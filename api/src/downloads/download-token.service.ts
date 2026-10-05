import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { DOWNLOAD_AUDIENCE, PortalSession } from '../auth/session';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import type { EnvironmentId } from '../systems/systems.service';

export interface DownloadGrant {
  systemId: string;
  environment: EnvironmentId;
  appId: string;
  version: string;
  username: string;
}

interface DownloadClaims {
  sys: string;
  env: EnvironmentId;
  app: string;
  ver: string;
  sub: string;
}

/**
 * Token do link de download (botão e QR Code). É auto-contido para não exigir
 * banco: expira em DOWNLOAD_LINK_TTL_SECONDS e só serve para uma versão de um app.
 */
@Injectable()
export class DownloadTokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `environment` é o ambiente pelo qual a versão foi liberada para a sessão (ver findVisibleVersion). */
  async issue(session: PortalSession, appId: string, version: string, environment: EnvironmentId): Promise<{ url: string; expiresAt: string }> {
    const claims: DownloadClaims = {
      sys: session.systemId,
      env: environment,
      app: appId,
      ver: version,
      sub: session.username,
    };
    const token = await this.jwt.signAsync(claims, {
      audience: DOWNLOAD_AUDIENCE,
      expiresIn: this.config.downloadLinkTtlSeconds,
    });
    return {
      url: `${this.config.publicUrl}/d/${token}`,
      expiresAt: new Date(Date.now() + this.config.downloadLinkTtlSeconds * 1000).toISOString(),
    };
  }

  async verify(token: string): Promise<DownloadGrant> {
    const c = await this.jwt.verifyAsync<DownloadClaims>(token, { audience: DOWNLOAD_AUDIENCE });
    return { systemId: c.sys, environment: c.env, appId: c.app, version: c.ver, username: c.sub };
  }
}
