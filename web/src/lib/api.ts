export type EnvironmentId = 'hml' | 'staging' | 'prod';

export interface PortalSystem {
  id: string;
  name: string;
  description: string;
  available: boolean;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  /** canSeeTestBuilds: Master do i-monitor, que também recebe os builds de homologação/staging. */
  user: { username: string; profile: string; canSeeTestBuilds: boolean };
  system: { id: string; name: string };
}

export interface AppVersion {
  version: string;
  build: number | null;
  releaseNotes: string;
  sizeBytes: number | null;
  publishedAt: string;
}

/** Versões de um app em um ambiente. Usuário comum só recebe o canal de produção. */
export interface AppChannel {
  environment: { id: EnvironmentId; name: string };
  current: AppVersion;
  previous: AppVersion[];
}

export interface PortalApp {
  id: string;
  name: string;
  description: string;
  /** Produção sempre primeiro. */
  channels: AppChannel[];
}

export interface DownloadLink {
  url: string;
  expiresAt: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// URL da API. Vazia = mesma origem (desenvolvimento, ou API servindo o front).
// No Amplify aponta para o API Gateway da Lambda (ex.: https://xxxx.execute-api.sa-east-1.amazonaws.com/hml).
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (init.body) headers['Content-Type'] = 'application/json';
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetch(API_BASE + path, { ...init, headers });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sem conexão com o portal. Verifique sua internet.');
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, body?.code ?? 'UNKNOWN', body?.message ?? 'Algo deu errado. Tente novamente.');
  }
  return body as T;
}

export const api = {
  systems: () => call<{ systems: PortalSystem[] }>('/api/systems').then((r) => r.systems),

  login: (system: string, username: string, password: string) =>
    call<LoginResult>('/api/auth/login', { method: 'POST', body: JSON.stringify({ system, username, password }) }),

  apps: (token: string) => call<{ apps: PortalApp[] }>('/api/apps', { token }).then((r) => r.apps),

  downloadLink: (token: string, appId: string, version: string) =>
    call<DownloadLink>(`/api/apps/${encodeURIComponent(appId)}/versions/${encodeURIComponent(version)}/link`, {
      method: 'POST',
      token,
    }),
};
