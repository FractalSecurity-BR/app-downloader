import {
  BadGatewayException,
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';

import type { SystemConfig } from '../systems/systems.service';

/** Dados do usuário lidos do access_token devolvido pelo sistema. */
export interface UpstreamUser {
  username: string;
  aliasLevel: string;
  customerId: string;
  operatorType: string;
  role: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const [, payload] = token.split('.');
  if (!payload) throw new Error('token sem payload');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Faz o login no backend do sistema (contrato do i-monitor: POST /auth/login
 * { username, password } → { access_token, refresh_token, role }).
 *
 * O token do sistema é usado só para ler perfil e empresa do usuário e é
 * descartado em seguida: o portal não guarda senha nem token do sistema. A
 * assinatura não é verificada porque o portal não tem o segredo do sistema;
 * a confiança vem de o token ter sido recebido direto do backend via HTTPS.
 */
export async function upstreamLogin(
  system: Pick<SystemConfig, 'authBaseUrl' | 'loginPath'>,
  username: string,
  password: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<UpstreamUser> {
  let res: Response;
  try {
    res = await fetchImpl(system.authBaseUrl + system.loginPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new BadGatewayException({ code: 'SYSTEM_UNAVAILABLE', message: 'Não foi possível contatar o sistema' });
  }

  const body: any = await res.json().catch(() => null);

  // O i-monitor responde 401 para usuário inexistente ou senha errada e 403 quando o usuário foi
  // bloqueado após 3 tentativas. O AllExceptionsFilter dos backends reescreve o corpo como
  // { statusCode, message, reasons } e descarta o `code`, então o bloqueio é reconhecido pelo
  // status/mensagem ("User is blocked. Please try again in N minute(s).").
  // 404 aqui indica authBaseUrl/loginPath errado, não credencial.
  if (res.status === HttpStatus.UNAUTHORIZED || res.status === HttpStatus.FORBIDDEN) {
    const message = typeof body?.message === 'string' ? body.message : '';
    if (body?.code === 'USER_BLOCKED' || res.status === HttpStatus.FORBIDDEN || /blocked/i.test(message)) {
      const minutes = Number(body?.minutes ?? message.match(/(\d+)\s*minute/i)?.[1]);
      const wait = Number.isInteger(minutes) && minutes > 0 ? `${minutes} minuto(s)` : 'alguns minutos';
      throw new HttpException(
        { code: 'USER_BLOCKED', message: `Usuário bloqueado temporariamente por excesso de tentativas. Tente novamente em ${wait}.` },
        423, // Locked
      );
    }
    throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Usuário ou senha inválidos' });
  }
  if (res.status === HttpStatus.BAD_REQUEST) {
    throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Usuário ou senha inválidos' });
  }
  if (!res.ok) {
    throw new BadGatewayException({ code: 'SYSTEM_UNAVAILABLE', message: 'O sistema não respondeu corretamente' });
  }

  if (body?.setNewPassword) {
    throw new ConflictException({
      code: 'SET_NEW_PASSWORD',
      message: 'É preciso definir uma nova senha no sistema antes de acessar o portal',
    });
  }

  if (typeof body?.access_token !== 'string') {
    throw new BadGatewayException({ code: 'SYSTEM_UNAVAILABLE', message: 'Resposta de login inesperada do sistema' });
  }

  let claims: Record<string, unknown>;
  try {
    claims = decodeJwtPayload(body.access_token);
  } catch {
    throw new BadGatewayException({ code: 'SYSTEM_UNAVAILABLE', message: 'Token do sistema em formato inesperado' });
  }

  return {
    username: text(claims.username) || username,
    aliasLevel: text(claims.alias_level),
    customerId: text(claims.customer_id),
    operatorType: text(claims.operator_type),
    role: text(claims.role ?? body.role),
  };
}
