import path from 'node:path';

// Raiz do repositório (api/src/config ou api/dist/config → ../../..).
const REPO_ROOT = path.resolve(__dirname, '../../..');

export type StorageDriver = 's3' | 'local';

export interface AppConfig {
  port: number;
  /** URL pública da API: base dos links de download (/d/<token>) e do QR Code. */
  publicUrl: string;
  /** URL do front. Igual à publicUrl quando a API serve o front; diferente com Amplify + Lambda. */
  webUrl: string;
  /** Origens liberadas no CORS (o front no Amplify chama a API no API Gateway). */
  corsOrigins: string[];
  jwtSecret: string;
  sessionTtlSeconds: number;
  downloadLinkTtlSeconds: number;
  presignTtlSeconds: number;
  upstreamTimeoutMs: number;
  manifestCacheSeconds: number;
  loginRateLimitPerMinute: number;
  systemsConfigPath: string;
  manifestSchemaPath: string;
  webDistPath: string;
  storage: {
    driver: StorageDriver;
    bucket?: string;
    region: string;
    localDir: string;
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} precisa ser inteiro positivo`);
  return value;
}

function fromRoot(value: string | undefined, fallback: string): string {
  return path.resolve(REPO_ROOT, value || fallback);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const jwtSecret = env.PORTAL_JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('PORTAL_JWT_SECRET precisa ter pelo menos 32 caracteres');
  }

  const driver = (env.STORAGE_DRIVER ?? 's3') as StorageDriver;
  if (driver !== 's3' && driver !== 'local') throw new Error(`STORAGE_DRIVER inválido: ${driver}`);
  if (driver === 's3' && !env.S3_BUCKET) throw new Error('S3_BUCKET é obrigatório com STORAGE_DRIVER=s3');

  const port = int(env, 'PORT', 3000);
  const publicUrl = (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  const webUrl = (env.WEB_URL || publicUrl).replace(/\/+$/, '');
  return {
    port,
    publicUrl,
    webUrl,
    corsOrigins: (env.CORS_ORIGINS || webUrl)
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    jwtSecret,
    sessionTtlSeconds: int(env, 'SESSION_TTL_SECONDS', 30 * 60),
    downloadLinkTtlSeconds: int(env, 'DOWNLOAD_LINK_TTL_SECONDS', 10 * 60),
    presignTtlSeconds: int(env, 'PRESIGN_TTL_SECONDS', 5 * 60),
    // Folga para a partida a frio dos Lambdas dos sistemas (~12 s observados em HML).
    upstreamTimeoutMs: int(env, 'UPSTREAM_TIMEOUT_MS', 30_000),
    manifestCacheSeconds: int(env, 'MANIFEST_CACHE_SECONDS', 30),
    loginRateLimitPerMinute: int(env, 'LOGIN_RATE_LIMIT_PER_MINUTE', 10),
    systemsConfigPath: fromRoot(env.SYSTEMS_CONFIG_PATH, 'config/systems.json'),
    manifestSchemaPath: fromRoot(env.MANIFEST_SCHEMA_PATH, 'manifest/manifest.schema.json'),
    webDistPath: fromRoot(env.WEB_DIST_PATH, 'web/dist'),
    storage: {
      driver,
      bucket: env.S3_BUCKET,
      region: env.AWS_REGION ?? 'sa-east-1',
      localDir: fromRoot(env.LOCAL_STORAGE_DIR, 'dev-storage'),
    },
  };
}
