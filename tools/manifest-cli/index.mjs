#!/usr/bin/env node
// CLI que mantém os manifestos do Portal de Aplicativos.
// Usado pela action .github/actions/publish-app e pelos workflows manuais.
//
//   publish     --system --app-id --version --environment --file [--app-name --description --build --release-notes --commit --created-by]
//   promote     --system --app-id --version --environment
//   block       --system --app-id --version [--reason]
//   unblock     --system --app-id --version
//   set-access  --system --app-id [--roles a,b] [--operator-types a,b] [--customers id1,id2]   ("" limpa o critério)
//   show        --system
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import {
  ENVIRONMENTS,
  ManifestError,
  apkKey,
  applyBlock,
  applyPromote,
  applyPublish,
  applySetAccess,
  applyUnblock,
  emptyManifest,
} from './manifest-ops.mjs';
import { ConflictError, createStorage } from './storage.mjs';

const MAX_ATTEMPTS = 5;
const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = process.env.MANIFEST_SCHEMA_PATH ?? path.resolve(here, '../../manifest/manifest.schema.json');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    system: { type: 'string' },
    'app-id': { type: 'string' },
    'app-name': { type: 'string' },
    description: { type: 'string' },
    version: { type: 'string' },
    build: { type: 'string' },
    environment: { type: 'string' },
    file: { type: 'string' },
    'release-notes': { type: 'string' },
    commit: { type: 'string' },
    'created-by': { type: 'string' },
    reason: { type: 'string' },
    roles: { type: 'string' },
    'operator-types': { type: 'string' },
    customers: { type: 'string' },
  },
});

function required(name) {
  const value = values[name]?.trim();
  if (!value) throw new ManifestError(`Parâmetro obrigatório: --${name}`);
  return value;
}

function list(name) {
  if (values[name] === undefined) return undefined;
  return values[name].split(',').map((s) => s.trim()).filter(Boolean);
}

async function loadValidator() {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(await readFile(schemaPath, 'utf8')));
}

// Lê o manifesto, aplica a alteração, valida e grava com escrita condicional.
// Se outro processo gravou no meio, relê e reaplica.
async function updateManifest(storage, system, change) {
  const validate = await loadValidator();
  const key = `${system}/manifest.json`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const { data, etag } = await storage.readJson(key);
    const next = change(data ?? emptyManifest(system));
    if (!validate(next)) {
      throw new ManifestError(`Manifesto resultante inválido, nada foi gravado:\n${JSON.stringify(validate.errors, null, 2)}`);
    }
    try {
      await storage.writeJson(key, next, etag);
      return next;
    } catch (err) {
      if (!(err instanceof ConflictError) || attempt === MAX_ATTEMPTS) throw err;
      console.warn(`Manifesto alterado por outro processo, tentando de novo (${attempt}/${MAX_ATTEMPTS})`);
    }
  }
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

async function publish(storage) {
  const system = required('system');
  const appId = required('app-id');
  const version = required('version');
  const environment = required('environment');
  const filePath = required('file');
  const file = apkKey(system, appId, version);
  const slug = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  if (!slug.test(system)) throw new ManifestError(`--system deve ser minúsculo com hífens (ex.: containers-exportacao): ${system}`);
  if (!slug.test(appId)) throw new ManifestError(`--app-id deve ser minúsculo com hífens (ex.: imonitor-costado): ${appId}`);
  if (!/^[0-9A-Za-z.+_-]+$/.test(version)) throw new ManifestError(`--version com caracteres inválidos: ${version}`);
  if (!ENVIRONMENTS.includes(environment)) {
    throw new ManifestError(`Ambiente inválido "${environment}". Use: ${ENVIRONMENTS.join(', ')}`);
  }
  let build;
  if (values.build) {
    if (!/^\d+$/.test(values.build)) throw new ManifestError(`--build precisa ser número inteiro: ${values.build}`);
    build = Number(values.build);
  }

  const { data } = await storage.readJson(`${system}/manifest.json`);
  if (data?.apps.some((a) => a.id === appId && a.versions.some((v) => v.version === version))) {
    throw new ManifestError(`Versão "${version}" do app "${appId}" já foi publicada. Gere uma versão nova.`);
  }

  const { size } = await stat(filePath);
  const hash = await sha256(filePath);
  console.log(`Enviando ${filePath} → ${file} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  try {
    await storage.uploadNew(file, filePath, hash);
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    // Arquivo já existe mas a versão não está no manifesto: uma execução anterior
    // subiu o APK e falhou antes de gravar o manifesto. Só retoma se for o mesmo binário.
    if ((await storage.sha256Of(file)) !== hash) {
      throw new ManifestError(`O arquivo ${file} já existe no bucket com outro conteúdo. Gere uma versão nova.`);
    }
    console.warn(`APK idêntico já estava no bucket (execução anterior interrompida). Registrando no manifesto.`);
  }

  const release = {
    appId,
    appName: values['app-name'],
    description: values.description,
    version,
    environment,
    file,
    sizeBytes: size,
    sha256: hash,
    releaseNotes: values['release-notes']?.trim() || undefined,
    commit: values.commit,
    createdBy: values['created-by'],
  };
  if (build !== undefined) release.build = build;
  return updateManifest(storage, system, (m) => applyPublish(m, release));
}

const commands = {
  publish,
  promote: (storage) =>
    updateManifest(storage, required('system'), (m) =>
      applyPromote(m, { appId: required('app-id'), version: required('version'), environment: required('environment') }),
    ),
  block: (storage) =>
    updateManifest(storage, required('system'), (m) =>
      applyBlock(m, { appId: required('app-id'), version: required('version'), reason: values.reason }),
    ),
  unblock: (storage) =>
    updateManifest(storage, required('system'), (m) =>
      applyUnblock(m, { appId: required('app-id'), version: required('version') }),
    ),
  'set-access': (storage) =>
    updateManifest(storage, required('system'), (m) =>
      applySetAccess(m, {
        appId: required('app-id'),
        roles: list('roles'),
        operatorTypes: list('operator-types'),
        customers: list('customers'),
      }),
    ),
  show: async (storage) => {
    const { data } = await storage.readJson(`${required('system')}/manifest.json`);
    if (!data) throw new ManifestError('Manifesto ainda não existe para esse sistema');
    return data;
  },
};

async function main() {
  const [command] = positionals;
  const run = commands[command];
  if (!run) {
    console.error(`Uso: manifest-cli <${Object.keys(commands).join('|')}> [opções]`);
    process.exit(2);
  }
  const manifest = await run(createStorage());
  const summary = manifest.apps.map((a) => `  ${a.id}: ${JSON.stringify(a.current)}`).join('\n');
  console.log(`OK — ${manifest.system} (atualizado em ${manifest.updatedAt})\n${summary}`);
  if (command === 'show') console.log(JSON.stringify(manifest, null, 2));
}

main().catch((err) => {
  console.error(err instanceof ManifestError ? `Erro: ${err.message}` : err);
  process.exit(1);
});
