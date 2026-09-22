// Acesso ao armazenamento dos APKs e manifestos.
// STORAGE_DRIVER=s3 (padrão) usa o bucket S3_BUCKET; STORAGE_DRIVER=local usa a
// pasta LOCAL_STORAGE_DIR, para desenvolvimento e testes sem AWS.
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ConflictError extends Error {}

export function createStorage(env = process.env) {
  const driver = env.STORAGE_DRIVER ?? 's3';
  if (driver === 'local') return new LocalStorage(env.LOCAL_STORAGE_DIR ?? './dev-storage');
  if (driver === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET não definido');
    return new S3Storage(env.S3_BUCKET, env.AWS_REGION ?? 'sa-east-1');
  }
  throw new Error(`STORAGE_DRIVER inválido: ${driver}`);
}

class LocalStorage {
  constructor(root) {
    this.root = path.resolve(root);
  }

  #path(key) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error(`Chave fora do diretório: ${key}`);
    return full;
  }

  async #etag(full) {
    return createHash('md5').update(await readFile(full)).digest('hex');
  }

  async readJson(key) {
    const full = this.#path(key);
    try {
      const body = await readFile(full, 'utf8');
      return { data: JSON.parse(body), etag: await this.#etag(full) };
    } catch (err) {
      if (err.code === 'ENOENT') return { data: null, etag: null };
      throw err;
    }
  }

  async writeJson(key, data, etag) {
    const full = this.#path(key);
    const exists = await stat(full).then(() => true, () => false);
    if (etag === null && exists) throw new ConflictError(key);
    if (etag !== null && (!exists || (await this.#etag(full)) !== etag)) throw new ConflictError(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(data, null, 2) + '\n');
  }

  async uploadNew(key, filePath) {
    const full = this.#path(key);
    if (await stat(full).then(() => true, () => false)) throw new ConflictError(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, await readFile(filePath));
  }

  // Outros buckets são simulados em <LOCAL_STORAGE_DIR>/_buckets/<bucket>/<key>.
  async headExternal(bucket, key) {
    const info = await stat(this.#path(`_buckets/${bucket}/${key}`)).catch(() => null);
    return info ? { sizeBytes: info.size } : null;
  }

  async sha256Of(key) {
    try {
      return createHash('sha256').update(await readFile(this.#path(key))).digest('hex');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }
}

class S3Storage {
  constructor(bucket, region) {
    this.bucket = bucket;
    this.region = region;
  }

  async #client() {
    if (!this.s3) {
      const sdk = await import('@aws-sdk/client-s3');
      this.sdk = sdk;
      this.s3 = new sdk.S3Client({ region: this.region });
    }
    return this.s3;
  }

  async readJson(key) {
    const s3 = await this.#client();
    try {
      const res = await s3.send(new this.sdk.GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { data: JSON.parse(await res.Body.transformToString()), etag: res.ETag };
    } catch (err) {
      if (err.name === 'NoSuchKey') return { data: null, etag: null };
      throw err;
    }
  }

  // Escrita condicional: só grava se ninguém alterou o manifesto desde a leitura.
  async writeJson(key, data, etag) {
    const s3 = await this.#client();
    try {
      await s3.send(
        new this.sdk.PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(data, null, 2) + '\n',
          ContentType: 'application/json',
          CacheControl: 'no-cache',
          ...(etag === null ? { IfNoneMatch: '*' } : { IfMatch: etag }),
        }),
      );
    } catch (err) {
      if (isConflict(err)) throw new ConflictError(key);
      throw err;
    }
  }

  // Nunca sobrescreve um APK já publicado.
  async uploadNew(key, filePath, sha256) {
    const s3 = await this.#client();
    try {
      await s3.send(
        new this.sdk.PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: await readFile(filePath),
          ContentType: 'application/vnd.android.package-archive',
          Metadata: { sha256 },
          IfNoneMatch: '*',
        }),
      );
    } catch (err) {
      if (isConflict(err)) throw new ConflictError(key);
      throw err;
    }
  }

  // Confere se o APK existe em outro bucket (reaproveitamento) e devolve o tamanho.
  async headExternal(bucket, key) {
    const s3 = await this.#client();
    try {
      const res = await s3.send(new this.sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { sizeBytes: res.ContentLength };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  async sha256Of(key) {
    const s3 = await this.#client();
    try {
      const res = await s3.send(new this.sdk.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Metadata?.sha256 ?? '';
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }
}

function isConflict(err) {
  const status = err.$metadata?.httpStatusCode;
  return status === 412 || status === 409 || err.name === 'PreconditionFailed' || err.name === 'ConditionalRequestConflict';
}
