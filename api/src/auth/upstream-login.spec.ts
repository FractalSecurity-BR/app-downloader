import type { SystemConfig } from '../systems/systems.service';
import { upstreamLogin } from './upstream-login';

const env: Pick<SystemConfig, 'authBaseUrl' | 'loginPath'> = {
  authBaseUrl: 'https://sistema.test/prod',
  loginPath: '/auth/login',
};

function jwtWith(payload: object) {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part(payload)}.assinatura`;
}

function fakeFetch(status: number, body: unknown) {
  return jest.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

async function errorOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err: any) {
    return { status: err.getStatus(), code: err.getResponse().code };
  }
  throw new Error('esperava erro');
}

describe('upstreamLogin', () => {
  it('envia usuário e senha para authBaseUrl + loginPath e lê os dados do token', async () => {
    const fetch = fakeFetch(200, {
      access_token: jwtWith({ username: 'joao', alias_level: 'Operator', customer_id: 'c1', operator_type: 'inspector', role: 'x' }),
      refresh_token: 'r',
      role: 'x',
    });
    const user = await upstreamLogin(env, 'joao', 'segredo', 1000, fetch as any);

    expect(fetch).toHaveBeenCalledWith(
      'https://sistema.test/prod/auth/login',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ username: 'joao', password: 'segredo' }) }),
    );
    expect(user).toEqual({ username: 'joao', aliasLevel: 'Operator', customerId: 'c1', operatorType: 'inspector', role: 'x' });
  });

  it('401 vira INVALID_CREDENTIALS', async () => {
    const fetch = fakeFetch(401, { code: 'INVALID_CREDENTIALS' });
    expect(await errorOf(upstreamLogin(env, 'a', 'b', 1000, fetch as any))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('403 USER_BLOCKED vira 423', async () => {
    const fetch = fakeFetch(403, { code: 'USER_BLOCKED', minutes: 2 });
    expect(await errorOf(upstreamLogin(env, 'a', 'b', 1000, fetch as any))).toEqual({ status: 423, code: 'USER_BLOCKED' });
  });

  it('reconhece o formato real dos backends (AllExceptionsFilter, sem code)', async () => {
    const invalid = fakeFetch(401, { statusCode: 401, path: '/auth/login', message: 'Invalid credentials', reasons: [] });
    expect(await errorOf(upstreamLogin(env, 'a', 'b', 1000, invalid as any))).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });

    const blocked = fakeFetch(403, { statusCode: 403, message: 'User is blocked. Please try again in 2 minute(s).', reasons: [] });
    let message = '';
    try {
      await upstreamLogin(env, 'a', 'b', 1000, blocked as any);
    } catch (err: any) {
      expect(err.getStatus()).toBe(423);
      message = err.getResponse().message;
    }
    expect(message).toContain('2 minuto(s)');
  });

  it('setNewPassword vira 409 SET_NEW_PASSWORD', async () => {
    const fetch = fakeFetch(200, { setNewPassword: true });
    expect(await errorOf(upstreamLogin(env, 'a', 'b', 1000, fetch as any))).toEqual({ status: 409, code: 'SET_NEW_PASSWORD' });
  });

  it('404, 5xx, falha de rede e resposta sem token viram SYSTEM_UNAVAILABLE', async () => {
    for (const fetch of [
      fakeFetch(404, {}),
      fakeFetch(500, {}),
      fakeFetch(200, { ok: true }),
      jest.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    ]) {
      expect(await errorOf(upstreamLogin(env, 'a', 'b', 1000, fetch as any))).toEqual({ status: 502, code: 'SYSTEM_UNAVAILABLE' });
    }
  });
});
