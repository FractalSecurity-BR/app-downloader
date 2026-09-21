import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config/app-config';
import { configureApp } from '../src/main';

// Backend falso com o contrato do POST /auth/login do i-monitor.
const USERS: Record<string, { password: string; claims?: object; body?: object; status?: number }> = {
  operador: { password: 'certa', claims: { alias_level: 'Operator', customer_id: 'empresa-1', operator_type: 'stuffer' } },
  master: { password: 'certa', claims: { alias_level: 'Master', customer_id: 'fractal', operator_type: '' } },
  bloqueado: { password: 'x', status: 403, body: { code: 'USER_BLOCKED', minutes: 3 } },
  novasenha: { password: 'certa', body: { setNewPassword: true } },
};

function fakeJwt(payload: object) {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(payload)}.sig`;
}

function startUpstream(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status: number, body: object) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'POST' || req.url !== '/prod/auth/login') return send(404, { message: 'Not Found' });
      const { username, password } = JSON.parse(raw);
      const user = USERS[username];
      if (user?.status) return send(user.status, user.body!);
      if (!user || user.password !== password) return send(401, { code: 'INVALID_CREDENTIALS' });
      if (user.body) return send(200, user.body);
      send(200, { access_token: fakeJwt({ username, sub: '1', ...user.claims }), refresh_token: 'r', role: '' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const SYSTEM = 'containers-exportacao';

function version(v: string, environments: string[], status = 'published') {
  return {
    version: v,
    environments,
    status,
    file: `${SYSTEM}/imonitor/${v}/imonitor-${v}.apk`,
    sizeBytes: 3,
    createdAt: '2026-09-01T00:00:00Z',
    createdBy: 'test',
  };
}

describe('Portal de Aplicativos (e2e)', () => {
  let app: NestExpressApplication;
  let upstream: Server;
  let dir: string;

  beforeAll(async () => {
    upstream = await startUpstream();
    const { port } = upstream.address() as AddressInfo;
    dir = mkdtempSync(path.join(os.tmpdir(), 'portal-apps-'));

    writeFileSync(
      path.join(dir, 'systems.json'),
      JSON.stringify({
        systems: [
          { id: SYSTEM, name: 'Containers Exportação', authBaseUrl: `http://127.0.0.1:${port}/prod` },
          { id: 'concursos', name: 'Concursos', authBaseUrl: '', enabled: false },
        ],
      }),
    );

    const storage = path.join(dir, 'storage');
    for (const v of ['1.0.0', '1.1.0', '1.2.0']) {
      mkdirSync(path.join(storage, SYSTEM, 'imonitor', v), { recursive: true });
      writeFileSync(path.join(storage, SYSTEM, 'imonitor', v, `imonitor-${v}.apk`), `apk-${v}`);
    }
    writeFileSync(
      path.join(storage, SYSTEM, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        system: SYSTEM,
        updatedAt: '2026-09-01T00:00:00Z',
        apps: [
          {
            id: 'imonitor',
            name: 'I-monitor',
            platform: 'android',
            access: { roles: [], operatorTypes: [], customers: [] },
            current: { prod: '1.0.0', hml: '1.1.0' },
            versions: [version('1.0.0', ['hml', 'prod']), version('1.1.0', ['hml']), version('1.2.0', ['hml', 'prod'], 'blocked')],
          },
          {
            id: 'costado',
            name: 'I-monitor Costado',
            platform: 'android',
            access: { roles: [], operatorTypes: ['inspector'], customers: [] },
            current: { prod: '1.0.0' },
            versions: [{ ...version('1.0.0', ['prod']), file: `${SYSTEM}/costado/1.0.0/costado-1.0.0.apk` }],
          },
        ],
      }),
    );

    const config = loadConfig({
      PORTAL_JWT_SECRET: 'x'.repeat(40),
      PUBLIC_URL: 'http://portal.test',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: storage,
      SYSTEMS_CONFIG_PATH: path.join(dir, 'systems.json'),
      WEB_DIST_PATH: path.join(dir, 'sem-front'),
      MANIFEST_CACHE_SECONDS: '1',
      LOGIN_RATE_LIMIT_PER_MINUTE: '50',
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    upstream?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const login = (username: string, password = 'certa') =>
    request(app.getHttpServer()).post('/api/auth/login').send({ system: SYSTEM, username, password });

  const linkFor = (token: string, appId: string, version: string) =>
    request(app.getHttpServer()).post(`/api/apps/${appId}/versions/${version}/link`).set('Authorization', `Bearer ${token}`);

  async function download(url: string) {
    return request(app.getHttpServer())
      .get(new URL(url).pathname)
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.on('data', (c: Buffer) => (data += c.toString()));
        res.on('end', () => cb(null, data));
      });
  }

  it('lista os sistemas e marca quais estão disponíveis', async () => {
    const res = await request(app.getHttpServer()).get('/api/systems').expect(200);
    expect(res.body.systems).toEqual([
      expect.objectContaining({ id: SYSTEM, available: true }),
      expect.objectContaining({ id: 'concursos', available: false }),
    ]);
  });

  it('recusa sistema desabilitado e payload inválido', async () => {
    await request(app.getHttpServer()).post('/api/auth/login').send({ system: 'concursos', username: 'operador', password: 'certa' }).expect(404);
    await request(app.getHttpServer()).post('/api/auth/login').send({ system: SYSTEM }).expect(400);
    // campo de ambiente não existe mais
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ system: SYSTEM, environment: 'hml', username: 'operador', password: 'certa' })
      .expect(400);
  });

  it('mapeia os erros do sistema', async () => {
    expect((await login('operador', 'errada').expect(401)).body.code).toBe('INVALID_CREDENTIALS');
    expect((await login('ninguem').expect(401)).body.code).toBe('INVALID_CREDENTIALS');
    expect((await login('bloqueado', 'x').expect(423)).body.code).toBe('USER_BLOCKED');
    expect((await login('novasenha').expect(409)).body.code).toBe('SET_NEW_PASSWORD');
  });

  it('exige sessão para listar apps', async () => {
    await request(app.getHttpServer()).get('/api/apps').expect(401);
    await request(app.getHttpServer()).get('/api/apps').set('Authorization', 'Bearer lixo').expect(401);
  });

  it('operador vê só produção, sem apps restritos nem versão bloqueada', async () => {
    const res = (await login('OPERADOR ').expect(200)).body;
    expect(res.user.canSeeTestBuilds).toBe(false);
    const apps = (await request(app.getHttpServer()).get('/api/apps').set('Authorization', `Bearer ${res.token}`).expect(200)).body.apps;
    expect(apps).toHaveLength(1);
    expect(apps[0].id).toBe('imonitor');
    expect(apps[0].channels).toHaveLength(1);
    expect(apps[0].channels[0]).toMatchObject({ environment: { id: 'prod', name: 'Produção' }, current: { version: '1.0.0' }, previous: [] });
  });

  it('Master vê os apps restritos e também o canal de homologação', async () => {
    const res = (await login('master').expect(200)).body;
    expect(res.user.canSeeTestBuilds).toBe(true);
    const apps = (await request(app.getHttpServer()).get('/api/apps').set('Authorization', `Bearer ${res.token}`).expect(200)).body.apps;
    expect(apps.map((a: any) => a.id)).toEqual(['imonitor', 'costado']);
    expect(apps[0].channels.map((c: any) => [c.environment.id, c.current.version])).toEqual([
      ['prod', '1.0.0'],
      ['hml', '1.1.0'],
    ]);
  });

  it('gera link temporário e entrega o APK de produção', async () => {
    const { token } = (await login('operador').expect(200)).body;
    const link = await linkFor(token, 'imonitor', '1.0.0').expect(200);
    expect(link.body.url).toMatch(/^http:\/\/portal\.test\/d\/[\w-]+\.[\w-]+\.[\w-]+$/);

    const file = await download(link.body.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-disposition']).toContain('imonitor-1.0.0.apk');
    expect(file.body).toBe('apk-1.0.0');
  });

  it('build de homologação só é liberado para Master', async () => {
    const operador = (await login('operador').expect(200)).body.token;
    await linkFor(operador, 'imonitor', '1.1.0').expect(404);

    const master = (await login('master').expect(200)).body.token;
    const link = await linkFor(master, 'imonitor', '1.1.0').expect(200);
    expect((await download(link.body.url)).body).toBe('apk-1.1.0');
  });

  it('não gera link para versão bloqueada nem para app sem permissão', async () => {
    const { token } = (await login('operador').expect(200)).body;
    await linkFor(token, 'imonitor', '1.2.0').expect(404);
    await linkFor(token, 'costado', '1.0.0').expect(404);
  });

  it('token inválido, ou token de sessão usado como download, vai para a página de link expirado', async () => {
    const { token } = (await login('operador').expect(200)).body;
    for (const t of ['lixo', token]) {
      const res = await request(app.getHttpServer()).get(`/d/${t}`).expect(302);
      expect(res.headers.location).toBe('http://portal.test/link-expirado');
    }
  });

  it('link de download não serve como sessão', async () => {
    const { token } = (await login('operador').expect(200)).body;
    const link = await linkFor(token, 'imonitor', '1.0.0').expect(200);
    const downloadToken = link.body.url.split('/d/')[1];
    await request(app.getHttpServer()).get('/api/apps').set('Authorization', `Bearer ${downloadToken}`).expect(401);
  });
});
