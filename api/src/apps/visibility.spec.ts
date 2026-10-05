import type { PortalSession } from '../auth/session';
import type { Manifest, ManifestApp, ManifestVersion } from '../manifest/manifest.service';
import { allowedEnvironments, canSeeApp, findVisibleVersion, visibleApps } from './visibility';

function session(overrides: Partial<PortalSession> = {}): PortalSession {
  return {
    username: 'operador',
    aliasLevel: 'Operator',
    customerId: 'empresa-1',
    operatorType: 'stuffer',
    role: '',
    systemId: 'containers-exportacao',
    ...overrides,
  };
}

const master = () => session({ username: 'master', aliasLevel: 'Master' });

function version(v: string, overrides: Partial<ManifestVersion> = {}): ManifestVersion {
  return {
    version: v,
    environments: ['hml', 'prod'],
    status: 'published',
    file: `containers-exportacao/app/${v}/app-${v}.apk`,
    createdAt: '2026-09-01T00:00:00Z',
    createdBy: 'test',
    ...overrides,
  };
}

// 1.0.0 em hml+prod (atual de prod), 1.1.0 só em hml (atual de hml)
function app(overrides: Partial<ManifestApp> = {}): ManifestApp {
  return {
    id: 'app',
    name: 'App',
    platform: 'android',
    access: { roles: [], operatorTypes: [], customers: [] },
    current: { prod: '1.0.0', hml: '1.1.0' },
    versions: [version('1.0.0'), version('1.1.0', { environments: ['hml'] })],
    ...overrides,
  };
}

function manifest(...apps: ManifestApp[]): Manifest {
  return { schemaVersion: 1, system: 'containers-exportacao', updatedAt: '2026-09-01T00:00:00Z', apps };
}

describe('allowedEnvironments', () => {
  it('usuário comum vê só produção; Master vê também homologação e staging', () => {
    expect(allowedEnvironments(session())).toEqual(['prod']);
    expect(allowedEnvironments(session({ aliasLevel: 'Manager' }))).toEqual(['prod']);
    expect(allowedEnvironments(master())).toEqual(['prod', 'hml', 'staging']);
  });
});

describe('canSeeApp', () => {
  it('libera todos quando não há restrição', () => {
    expect(canSeeApp(app(), session())).toBe(true);
  });

  it('aplica perfil, tipo de operador e empresa juntos', () => {
    const restricted = app({ access: { roles: ['Operator'], operatorTypes: ['inspector'], customers: [] } });
    expect(canSeeApp(restricted, session({ operatorType: 'inspector' }))).toBe(true);
    expect(canSeeApp(restricted, session({ operatorType: 'stuffer' }))).toBe(false);
    expect(canSeeApp(app({ access: { roles: [], operatorTypes: [], customers: ['outra'] } }), session())).toBe(false);
  });

  it('Master vê tudo', () => {
    const restricted = app({ access: { roles: ['Manager'], operatorTypes: [], customers: ['outra'] } });
    expect(canSeeApp(restricted, master())).toBe(true);
  });
});

describe('visibleApps', () => {
  it('usuário comum recebe só o canal de produção', () => {
    const [a] = visibleApps(manifest(app()), session());
    expect(a.channels.map((c) => c.environment)).toEqual(['prod']);
    expect(a.channels[0].current.version).toBe('1.0.0');
    expect(a.channels[0].previous).toEqual([]);
  });

  it('Master recebe produção e homologação, cada um com sua versão atual', () => {
    const [a] = visibleApps(manifest(app()), master());
    expect(a.channels.map((c) => c.environment)).toEqual(['prod', 'hml']);
    const hml = a.channels[1];
    expect(hml.current.version).toBe('1.1.0');
    // 1.0.0 também está em produção: aparece só lá, não se repete em homologação
    expect(hml.previous).toEqual([]);
  });

  it('Master não vê canal de homologação quando todas as versões já estão em produção', () => {
    const promoted = app({ current: { prod: '1.0.0', hml: '1.0.0' }, versions: [version('1.0.0')] });
    expect(visibleApps(manifest(promoted), master())[0].channels.map((c) => c.environment)).toEqual(['prod']);
  });

  it('app só com build de homologação não aparece para usuário comum', () => {
    const onlyHml = app({ current: { hml: '1.1.0' }, versions: [version('1.1.0', { environments: ['hml'] })] });
    expect(visibleApps(manifest(onlyHml), session())).toEqual([]);
    expect(visibleApps(manifest(onlyHml), master())[0].channels.map((c) => c.environment)).toEqual(['hml']);
  });

  it('ignora versões bloqueadas e apps sem versão disponível', () => {
    const blocked = app({ versions: [version('1.0.0', { status: 'blocked' })], current: {} });
    expect(visibleApps(manifest(blocked), master())).toEqual([]);
  });

  it('usa a versão mais nova quando o current aponta para algo indisponível', () => {
    const a = app({ current: { prod: '9.9.9' }, versions: [version('1.0.0'), version('1.2.0')] });
    expect(visibleApps(manifest(a), session())[0].channels[0].current.version).toBe('1.2.0');
  });

  it('retorna vazio sem manifesto', () => {
    expect(visibleApps(null, session())).toEqual([]);
  });
});

describe('findVisibleVersion', () => {
  it('libera versão de produção para todos e informa o ambiente', () => {
    expect(findVisibleVersion(manifest(app()), session(), 'app', '1.0.0')).toMatchObject({ environment: 'prod' });
  });

  it('build só de homologação é liberado apenas para Master', () => {
    const m = manifest(app());
    expect(findVisibleVersion(m, session(), 'app', '1.1.0')).toBeNull();
    expect(findVisibleVersion(m, master(), 'app', '1.1.0')).toMatchObject({ environment: 'hml' });
  });

  it('recusa app inexistente, versão bloqueada e app restrito', () => {
    expect(findVisibleVersion(manifest(app()), session(), 'outro', '1.0.0')).toBeNull();
    const blocked = manifest(app({ versions: [version('1.0.0', { status: 'blocked' })] }));
    expect(findVisibleVersion(blocked, master(), 'app', '1.0.0')).toBeNull();
    const restricted = manifest(app({ access: { roles: ['Manager'], operatorTypes: [], customers: [] } }));
    expect(findVisibleVersion(restricted, session(), 'app', '1.0.0')).toBeNull();
  });
});
