// Regras puras de alteração do manifesto. Não fazem I/O: recebem o manifesto
// atual e devolvem um novo, para poderem ser reaplicadas quando a escrita
// condicional no S3 falhar por concorrência.

export const ENVIRONMENTS = ['hml', 'staging', 'prod'];

export class ManifestError extends Error {}

export function emptyManifest(system) {
  return { schemaVersion: 1, system, updatedAt: new Date().toISOString(), apps: [] };
}

export function apkKey(system, appId, version) {
  return `${system}/${appId}/${version}/${appId}-${version}.apk`;
}

function clone(manifest) {
  return structuredClone(manifest);
}

function findApp(manifest, appId) {
  const app = manifest.apps.find((a) => a.id === appId);
  if (!app) throw new ManifestError(`App "${appId}" não existe no manifesto de "${manifest.system}"`);
  return app;
}

function findVersion(app, version) {
  const found = app.versions.find((v) => v.version === version);
  if (!found) throw new ManifestError(`Versão "${version}" não existe no app "${app.id}"`);
  return found;
}

function assertEnvironment(environment) {
  if (!ENVIRONMENTS.includes(environment)) {
    throw new ManifestError(`Ambiente inválido "${environment}". Use: ${ENVIRONMENTS.join(', ')}`);
  }
}

// Versão publicada mais recente de um ambiente (a última adicionada ao manifesto).
function latestPublished(app, environment) {
  for (let i = app.versions.length - 1; i >= 0; i--) {
    const v = app.versions[i];
    if (v.status === 'published' && v.environments.includes(environment)) return v.version;
  }
  return undefined;
}

function touch(manifest) {
  manifest.updatedAt = new Date().toISOString();
  return manifest;
}

/**
 * Registra uma versão nova e a torna a atual no ambiente informado. Cria o app se ainda não existir.
 * Origem do APK: `file` (já enviado ao bucket do portal), `bucket` + `file` (APK que já existe em
 * outro bucket) ou `url` (link externo).
 */
export function applyPublish(manifest, release) {
  assertEnvironment(release.environment);
  const next = clone(manifest);

  let app = next.apps.find((a) => a.id === release.appId);
  if (!app) {
    app = {
      id: release.appId,
      name: release.appName ?? release.appId,
      platform: 'android',
      access: { roles: [], operatorTypes: [], customers: [] },
      current: {},
      versions: [],
    };
    next.apps.push(app);
  }
  if (release.appName) app.name = release.appName;
  if (release.description !== undefined) app.description = release.description;

  if (app.versions.some((v) => v.version === release.version)) {
    throw new ManifestError(`Versão "${release.version}" do app "${app.id}" já foi publicada. Gere uma versão nova.`);
  }

  const entry = {
    version: release.version,
    environments: [release.environment],
    status: 'published',
    // Origem do APK (exatamente uma): bucket do portal (file), outro bucket (bucket + file) ou link externo (url).
    ...(release.url ? { url: release.url } : { file: release.file }),
    ...(release.bucket ? { bucket: release.bucket } : {}),
    createdAt: new Date().toISOString(),
    createdBy: release.createdBy ?? 'manifest-cli',
  };
  if (release.build !== undefined) entry.build = release.build;
  if (release.sizeBytes !== undefined) entry.sizeBytes = release.sizeBytes;
  if (release.sha256) entry.sha256 = release.sha256;
  if (release.releaseNotes) entry.releaseNotes = release.releaseNotes;
  if (release.commit) entry.commit = release.commit;

  app.versions.push(entry);
  app.current[release.environment] = release.version;
  return touch(next);
}

/** Disponibiliza uma versão existente em outro ambiente e a torna a atual lá (também serve para rollback). */
export function applyPromote(manifest, { appId, version, environment }) {
  assertEnvironment(environment);
  const next = clone(manifest);
  const app = findApp(next, appId);
  const entry = findVersion(app, version);
  if (entry.status === 'blocked') {
    throw new ManifestError(`Versão "${version}" está bloqueada. Desbloqueie antes de promover.`);
  }
  if (!entry.environments.includes(environment)) entry.environments.push(environment);
  app.current[environment] = version;
  return touch(next);
}

/** Retira uma versão do portal sem apagar o arquivo. Onde ela era a atual, volta para a publicada anterior. */
export function applyBlock(manifest, { appId, version, reason }) {
  const next = clone(manifest);
  const app = findApp(next, appId);
  const entry = findVersion(app, version);
  entry.status = 'blocked';
  if (reason) entry.blockedReason = reason;

  for (const env of Object.keys(app.current)) {
    if (app.current[env] !== version) continue;
    const fallback = latestPublished(app, env);
    if (fallback) app.current[env] = fallback;
    else delete app.current[env];
  }
  return touch(next);
}

/** Volta a disponibilizar uma versão bloqueada. Não altera qual é a versão atual. */
export function applyUnblock(manifest, { appId, version }) {
  const next = clone(manifest);
  const entry = findVersion(findApp(next, appId), version);
  entry.status = 'published';
  delete entry.blockedReason;
  return touch(next);
}

/** Remove um app inteiro do manifesto (ex.: publicado no sistema errado). Os APKs não são apagados. */
export function applyRemoveApp(manifest, { appId }) {
  const next = clone(manifest);
  findApp(next, appId); // erro claro se não existir
  next.apps = next.apps.filter((a) => a.id !== appId);
  return touch(next);
}

/** Troca as regras de acesso. Critério omitido (undefined) é mantido; lista vazia remove a restrição. */
export function applySetAccess(manifest, { appId, roles, operatorTypes, customers }) {
  const next = clone(manifest);
  const app = findApp(next, appId);
  if (roles !== undefined) app.access.roles = roles;
  if (operatorTypes !== undefined) app.access.operatorTypes = operatorTypes;
  if (customers !== undefined) app.access.customers = customers;
  return touch(next);
}
