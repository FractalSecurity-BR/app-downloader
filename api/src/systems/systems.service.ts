import { readFileSync } from 'node:fs';

import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { APP_CONFIG, AppConfig } from '../config/app-config';

/** Ambientes em que uma versão de app pode ser publicada (ver manifest.schema.json). */
export const ENVIRONMENT_IDS = ['prod', 'hml', 'staging'] as const;
export type EnvironmentId = (typeof ENVIRONMENT_IDS)[number];

export const ENVIRONMENT_NAMES: Record<EnvironmentId, string> = {
  prod: 'Produção',
  hml: 'Homologação',
  staging: 'Staging',
};

export interface SystemConfig {
  id: string;
  name: string;
  description: string;
  /**
   * URL base do backend de PRODUÇÃO do sistema, sem barra final. O login é sempre feito
   * em produção: é lá que estão os usuários dos clientes e os Master do i-monitor.
   */
  authBaseUrl: string;
  loginPath: string;
  enabled: boolean;
}

export interface PublicSystem {
  id: string;
  name: string;
  description: string;
  available: boolean;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseSystemsConfig(raw: unknown): SystemConfig[] {
  const systems = (raw as { systems?: unknown })?.systems;
  if (!Array.isArray(systems) || systems.length === 0) throw new Error('systems.json: lista "systems" vazia');

  const ids = new Set<string>();
  return systems.map((s: any, i: number) => {
    const where = `systems.json: systems[${i}]`;
    if (typeof s?.id !== 'string' || !SLUG.test(s.id)) throw new Error(`${where}.id inválido`);
    if (ids.has(s.id)) throw new Error(`${where}.id duplicado: ${s.id}`);
    ids.add(s.id);
    if (typeof s.name !== 'string' || !s.name) throw new Error(`${where}.name obrigatório`);

    const enabled = s.enabled !== false;
    const authBaseUrl = typeof s.authBaseUrl === 'string' ? s.authBaseUrl.replace(/\/+$/, '') : '';
    if (enabled && !/^https?:\/\//.test(authBaseUrl)) throw new Error(`${where}.authBaseUrl obrigatório quando enabled`);

    return {
      id: s.id,
      name: s.name,
      description: s.description ?? '',
      authBaseUrl,
      loginPath: typeof s.loginPath === 'string' && s.loginPath ? s.loginPath : '/auth/login',
      enabled,
    };
  });
}

@Injectable()
export class SystemsService {
  private readonly systems: SystemConfig[];

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.systems = parseSystemsConfig(JSON.parse(readFileSync(config.systemsConfigPath, 'utf8')));
  }

  listPublic(): PublicSystem[] {
    return this.systems.map(({ id, name, description, enabled }) => ({ id, name, description, available: enabled }));
  }

  get(systemId: string): SystemConfig {
    const system = this.systems.find((s) => s.id === systemId && s.enabled);
    if (!system) throw new NotFoundException({ code: 'SYSTEM_NOT_AVAILABLE', message: 'Sistema indisponível' });
    return system;
  }
}
