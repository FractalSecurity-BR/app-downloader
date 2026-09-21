import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import {
  ManifestError,
  apkKey,
  applyBlock,
  applyPromote,
  applyPublish,
  applySetAccess,
  applyUnblock,
  emptyManifest,
} from './manifest-ops.mjs';

const schema = JSON.parse(await readFile(new URL('../../manifest/manifest.schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function release(version, environment = 'hml') {
  return {
    appId: 'imonitor-costado',
    appName: 'I-monitor Costado',
    version,
    environment,
    file: apkKey('containers-exportacao', 'imonitor-costado', version),
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
    createdBy: 'test',
  };
}

function withVersions(...versions) {
  return versions.reduce((m, v) => applyPublish(m, release(v)), emptyManifest('containers-exportacao'));
}

test('publish cria o app, registra a versão e a torna atual no ambiente', () => {
  const m = withVersions('1.0.0');
  const app = m.apps[0];
  assert.equal(app.name, 'I-monitor Costado');
  assert.deepEqual(app.current, { hml: '1.0.0' });
  assert.deepEqual(app.versions[0].environments, ['hml']);
  assert.equal(app.versions[0].status, 'published');
  assert.ok(validate(m), JSON.stringify(validate.errors));
});

test('publish não aceita a mesma versão duas vezes', () => {
  assert.throws(() => applyPublish(withVersions('1.0.0'), release('1.0.0')), ManifestError);
});

test('publish não altera o manifesto recebido', () => {
  const original = withVersions('1.0.0');
  const snapshot = structuredClone(original);
  applyPublish(original, release('1.1.0'));
  assert.deepEqual(original, snapshot);
});

test('promote leva a versão para outro ambiente e a torna atual lá', () => {
  const m = applyPromote(withVersions('1.0.0', '1.1.0'), { appId: 'imonitor-costado', version: '1.0.0', environment: 'prod' });
  const app = m.apps[0];
  assert.deepEqual(app.current, { hml: '1.1.0', prod: '1.0.0' });
  assert.deepEqual(app.versions[0].environments, ['hml', 'prod']);
  assert.ok(validate(m));
});

test('promote recusa versão bloqueada', () => {
  const m = applyBlock(withVersions('1.0.0'), { appId: 'imonitor-costado', version: '1.0.0' });
  assert.throws(() => applyPromote(m, { appId: 'imonitor-costado', version: '1.0.0', environment: 'prod' }), ManifestError);
});

test('block volta a versão atual para a publicada anterior do mesmo ambiente', () => {
  const m = applyBlock(withVersions('1.0.0', '1.1.0'), { appId: 'imonitor-costado', version: '1.1.0', reason: 'crash' });
  const app = m.apps[0];
  assert.equal(app.current.hml, '1.0.0');
  assert.equal(app.versions[1].status, 'blocked');
  assert.equal(app.versions[1].blockedReason, 'crash');
  assert.ok(validate(m));
});

test('block remove o ambiente do current quando não sobra versão publicada', () => {
  const m = applyBlock(withVersions('1.0.0'), { appId: 'imonitor-costado', version: '1.0.0' });
  assert.deepEqual(m.apps[0].current, {});
  assert.ok(validate(m));
});

test('unblock libera a versão sem trocar a atual', () => {
  let m = applyBlock(withVersions('1.0.0', '1.1.0'), { appId: 'imonitor-costado', version: '1.1.0', reason: 'crash' });
  m = applyUnblock(m, { appId: 'imonitor-costado', version: '1.1.0' });
  assert.equal(m.apps[0].versions[1].status, 'published');
  assert.equal(m.apps[0].versions[1].blockedReason, undefined);
  assert.equal(m.apps[0].current.hml, '1.0.0');
});

test('set-access mantém critérios omitidos e limpa os vazios', () => {
  let m = applySetAccess(withVersions('1.0.0'), { appId: 'imonitor-costado', roles: ['Operator'], customers: ['c1'] });
  m = applySetAccess(m, { appId: 'imonitor-costado', customers: [] });
  assert.deepEqual(m.apps[0].access, { roles: ['Operator'], operatorTypes: [], customers: [] });
});

test('app ou versão inexistente gera erro claro', () => {
  const m = withVersions('1.0.0');
  assert.throws(() => applyBlock(m, { appId: 'outro', version: '1.0.0' }), /App "outro" não existe/);
  assert.throws(() => applyBlock(m, { appId: 'imonitor-costado', version: '9.9.9' }), /Versão "9.9.9" não existe/);
});

test('ambiente inválido é recusado', () => {
  assert.throws(() => applyPublish(emptyManifest('dta'), { ...release('1.0.0'), environment: 'producao' }), /Ambiente inválido/);
});
