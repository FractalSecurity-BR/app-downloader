import { readFileSync } from 'node:fs';

import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import { APP_CONFIG, AppConfig } from '../config/app-config';
import { StorageService } from '../storage/storage.service';
import type { EnvironmentId } from '../systems/systems.service';

// Espelha manifest/manifest.schema.json (fonte da verdade, validada em tempo de execução).
export interface ManifestVersion {
  version: string;
  build?: number;
  environments: EnvironmentId[];
  status: 'published' | 'blocked';
  /** Origem do APK — exatamente uma: `file` (bucket do portal), `bucket` + `file` (outro bucket) ou `url` (link externo). */
  file?: string;
  bucket?: string;
  url?: string;
  sizeBytes?: number;
  sha256?: string;
  releaseNotes?: string;
  commit?: string;
  createdAt: string;
  createdBy: string;
  blockedReason?: string;
}

export interface ManifestApp {
  id: string;
  name: string;
  description?: string;
  platform: 'android';
  access: { roles: string[]; operatorTypes: string[]; customers: string[] };
  current: Partial<Record<EnvironmentId, string>>;
  versions: ManifestVersion[];
}

export interface Manifest {
  schemaVersion: 1;
  system: string;
  updatedAt: string;
  apps: ManifestApp[];
}

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);
  private readonly validate: ValidateFunction;
  private readonly cache = new Map<string, { at: number; manifest: Manifest | null }>();

  constructor(
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    this.validate = ajv.compile(JSON.parse(readFileSync(config.manifestSchemaPath, 'utf8')));
  }

  /** Manifesto do sistema, ou null se nenhum app foi publicado ainda. Cache curto para não ler o S3 a cada request. */
  async get(systemId: string): Promise<Manifest | null> {
    const cached = this.cache.get(systemId);
    if (cached && Date.now() - cached.at < this.config.manifestCacheSeconds * 1000) return cached.manifest;

    let raw: string | null;
    try {
      raw = await this.storage.readText(`${systemId}/manifest.json`);
    } catch (err) {
      this.logger.error(`falha ao ler manifesto de ${systemId}: ${(err as Error).message}`);
      throw new ServiceUnavailableException({ code: 'MANIFEST_UNAVAILABLE', message: 'Lista de apps indisponível no momento' });
    }

    let manifest: Manifest | null = null;
    if (raw !== null) {
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        data = undefined;
      }
      if (!this.validate(data) || (data as Manifest).system !== systemId) {
        this.logger.error(`manifesto inválido em ${systemId}: ${JSON.stringify(this.validate.errors ?? 'system divergente')}`);
        throw new ServiceUnavailableException({ code: 'MANIFEST_INVALID', message: 'Lista de apps indisponível no momento' });
      }
      manifest = data as Manifest;
    }

    this.cache.set(systemId, { at: Date.now(), manifest });
    return manifest;
  }
}
