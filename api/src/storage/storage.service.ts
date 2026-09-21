import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '../config/app-config';

export type DownloadTarget = { kind: 'redirect'; url: string } | { kind: 'file'; path: string };

/**
 * Leitura do bucket privado. Em produção (STORAGE_DRIVER=s3) o download é uma
 * URL assinada de curta duração; em desenvolvimento (local) o arquivo é servido
 * direto do disco pela própria API.
 */
@Injectable()
export class StorageService {
  private readonly s3?: S3Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    if (config.storage.driver === 's3') this.s3 = new S3Client({ region: config.storage.region });
  }

  /** Retorna o conteúdo do objeto ou null se ele não existir. */
  async readText(key: string): Promise<string | null> {
    if (!this.s3) {
      try {
        return await readFile(this.localPath(key), 'utf8');
      } catch (err: any) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    }
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.config.storage.bucket, Key: key }));
      return (await res.Body?.transformToString()) ?? null;
    } catch (err: any) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async downloadTarget(key: string, filename: string): Promise<DownloadTarget> {
    if (!this.s3) {
      const full = this.localPath(key);
      await stat(full);
      return { kind: 'file', path: full };
    }
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.config.storage.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
        ResponseContentType: 'application/vnd.android.package-archive',
      }),
      { expiresIn: this.config.presignTtlSeconds },
    );
    return { kind: 'redirect', url };
  }

  private localPath(key: string): string {
    const root = this.config.storage.localDir;
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error(`Chave fora do diretório local: ${key}`);
    return full;
  }
}
