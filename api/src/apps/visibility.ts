import type { PortalSession } from '../auth/session';
import type { Manifest, ManifestApp, ManifestVersion } from '../manifest/manifest.service';
import type { EnvironmentId } from '../systems/systems.service';

// Regras de quem vê o quê. Funções puras, cobertas por visibility.spec.ts.

export const MASTER_LEVEL = 'Master';

/**
 * Todo usuário vê os apps de produção. Builds de homologação/staging são para testes
 * internos e só aparecem para os Master do i-monitor (que logam com o usuário de produção).
 */
export function canSeeTestBuilds(session: PortalSession): boolean {
  return session.aliasLevel === MASTER_LEVEL;
}

/** Ambientes visíveis para a sessão, na ordem em que aparecem no portal. */
export function allowedEnvironments(session: PortalSession): EnvironmentId[] {
  return canSeeTestBuilds(session) ? ['prod', 'hml', 'staging'] : ['prod'];
}

function allows(list: string[], value: string): boolean {
  return list.length === 0 || list.includes(value);
}

export function canSeeApp(app: ManifestApp, session: PortalSession): boolean {
  if (session.aliasLevel === MASTER_LEVEL) return true;
  const { roles, operatorTypes, customers } = app.access;
  return allows(roles, session.aliasLevel) && allows(operatorTypes, session.operatorType) && allows(customers, session.customerId);
}

export interface VisibleChannel {
  environment: EnvironmentId;
  current: ManifestVersion;
  /** Demais versões desse canal, da mais nova para a mais antiga. */
  previous: ManifestVersion[];
}

export interface VisibleApp {
  app: ManifestApp;
  /** Um canal por ambiente com versão disponível; produção sempre primeiro. */
  channels: VisibleChannel[];
}

function availableIn(app: ManifestApp, environment: EnvironmentId): ManifestVersion[] {
  // Ordem do manifesto = ordem de publicação; invertida fica da mais nova para a mais antiga.
  return app.versions.filter((v) => v.status === 'published' && v.environments.includes(environment)).reverse();
}

export function visibleApps(manifest: Manifest | null, session: PortalSession): VisibleApp[] {
  if (!manifest) return [];
  const result: VisibleApp[] = [];

  for (const app of manifest.apps) {
    if (!canSeeApp(app, session)) continue;

    const channels: VisibleChannel[] = [];
    // Uma versão aparece só no primeiro canal em que está (produção primeiro): um build já
    // promovido para produção não se repete em homologação.
    const shown = new Set<string>();
    for (const environment of allowedEnvironments(session)) {
      const available = availableIn(app, environment).filter((v) => !shown.has(v.version));
      available.forEach((v) => shown.add(v.version));
      if (available.length === 0) continue;
      const current = available.find((v) => v.version === app.current[environment]) ?? available[0];
      channels.push({ environment, current, previous: available.filter((v) => v !== current) });
    }
    if (channels.length > 0) result.push({ app, channels });
  }
  return result;
}

/**
 * Versão que a sessão pode baixar, com o ambiente pelo qual ela foi liberada
 * (produção tem preferência quando a versão está em mais de um).
 */
export function findVisibleVersion(
  manifest: Manifest | null,
  session: PortalSession,
  appId: string,
  version: string,
): { app: ManifestApp; version: ManifestVersion; environment: EnvironmentId } | null {
  const app = manifest?.apps.find((a) => a.id === appId);
  if (!app || !canSeeApp(app, session)) return null;
  const found = app.versions.find((v) => v.version === version);
  if (!found || found.status !== 'published') return null;
  const environment = allowedEnvironments(session).find((env) => found.environments.includes(env));
  return environment ? { app, version: found, environment } : null;
}
