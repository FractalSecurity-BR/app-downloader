#!/usr/bin/env node
// CLI que mantém os manifestos do Portal de Aplicativos.
// Usado pela action .github/actions/publish-app e pelos workflows manuais.
//
//   publish     --system --app-id --version --environment <origem> [--app-name --description --build --release-notes --commit --created-by]
//               <origem> é uma destas:
//                 --file ./app.apk                          envia o APK para o bucket do portal (padrão)
//                 --source-bucket B --source-key k/app.apk  reaproveita um APK que já está em outro bucket (sem copiar)
//                 --url https://.../app.apk                 link externo (o portal só redireciona)
//   promote     --system --app-id --version --environment
//   block       --system --app-id --version [--reason]
//   unblock     --system --app-id --version
//   set-access  --system --app-id [--roles a,b] [--operator-types a,b] [--customers id1,id2]   ("" limpa o critério)
//   remove-app  --system --app-id
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
  applyRemoveApp,
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
    'source-bucket': { type: 'string' },
    'source-key': { type: 'string' },
    url: { type: 'string' },
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

  const modes = [values.file, values['source-bucket'] ?? values['source-key'], values.url].filter((v) => v !== undefined);
  if (modes.length !== 1) {
    throw new ManifestError('Informe exatamente uma origem: --file, --source-bucket + --source-key, ou --url');
  }

  const { data } = await storage.readJson(`${system}/manifest.json`);
  if (data?.apps.some((a) => a.id === appId && a.versions.some((v) => v.version === version))) {
    throw new ManifestError(`Versão "${version}" do app "${appId}" já foi publicada. Gere uma versão nova.`);
  }

  const release = {
    appId,
    appName: values['app-name'],
    description: values.description,
    version,
    environment,
    releaseNotes: values['release-notes']?.trim() || undefined,
    commit: values.commit,
    createdBy: values['created-by'],
  };
  if (build !== undefined) release.build = build;

  if (values.url !== undefined) {
    // Link externo: nada é enviado. O portal redireciona para ele depois do login.
    const url = values.url.trim();
    if (!/^https:\/\/\S+$/.test(url)) throw new ManifestError(`--url precisa ser https: ${url}`);
    console.warn('Atenção: link externo fica visível para quem baixa e pode ser repassado sem login.');
    release.url = url;
  } else if (values['source-bucket'] !== undefined || values['source-key'] !== undefined) {
    // APK que já existe em outro bucket: nada é copiado; o portal gera link assinado a partir dele.
    const bucket = required('source-bucket');
    const key = required('source-key').replace(/^\/+/, '');
    if (!key.endsWith('.apk')) throw new ManifestError(`--source-key precisa apontar para um .apk: ${key}`);
    const head = await storage.headExternal(bucket, key);
    if (head === null) throw new ManifestError(`APK não encontrado em s3://${bucket}/${key}`);
    if (head.sizeBytes !== undefined) release.sizeBytes = head.sizeBytes;
    console.log(`Referenciando s3://${bucket}/${key} (sem cópia)`);
    release.bucket = bucket;
    release.file = key;
  } else {
    const filePath = required('file');
    const file = apkKey(system, appId, version);
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
    release.file = file;
    release.sizeBytes = size;
    release.sha256 = hash;
  }

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
  'remove-app': (storage) =>
    updateManifest(storage, required('system'), (m) => applyRemoveApp(m, { appId: required('app-id') })),
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
