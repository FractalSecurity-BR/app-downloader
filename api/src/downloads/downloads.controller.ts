import { Controller, Get, Inject, Logger, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { APP_CONFIG, AppConfig } from '../config/app-config';
import { ManifestService } from '../manifest/manifest.service';
import { StorageService } from '../storage/storage.service';
import { DownloadTokenService } from './download-token.service';

/**
 * Destino do botão "Baixar" e do QR Code. Não exige sessão (o celular que lê o
 * QR não está logado): a autorização é o próprio token, curto e assinado.
 */
@Controller('d')
export class DownloadsController {
  private readonly logger = new Logger(DownloadsController.name);

  constructor(
    private readonly tokens: DownloadTokenService,
    private readonly manifests: ManifestService,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');

    let grant;
    try {
      grant = await this.tokens.verify(token);
    } catch {
      return res.redirect(302, `${this.config.webUrl}/link-expirado`);
    }

    // A versão pode ter sido bloqueada depois que o link foi gerado.
    const manifest = await this.manifests.get(grant.systemId);
    const version = manifest?.apps.find((a) => a.id === grant.appId)?.versions.find((v) => v.version === grant.version);
    if (!version || version.status !== 'published' || !version.environments.includes(grant.environment)) {
      this.logger.warn(`download recusado (versão indisponível) user=${grant.username} app=${grant.appId} version=${grant.version}`);
      return res.redirect(302, `${this.config.webUrl}/link-expirado?motivo=indisponivel`);
    }

    const filename = `${grant.appId}-${grant.version}.apk`;
    const target = await this.storage.downloadTarget(version.file, filename);
    this.logger.log(
      `download user=${grant.username} system=${grant.systemId} env=${grant.environment} app=${grant.appId} version=${grant.version}`,
    );

    if (target.kind === 'redirect') return res.redirect(302, target.url);
    return res.download(target.path, filename, { headers: { 'Content-Type': 'application/vnd.android.package-archive' } });
  }
}
