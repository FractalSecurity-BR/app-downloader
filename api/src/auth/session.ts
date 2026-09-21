import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { APP_CONFIG, AppConfig } from '../config/app-config';
import type { UpstreamUser } from './upstream-login';

/** Sessão do portal. Não tem ambiente: o login é sempre em produção e o perfil decide o que se vê. */
export interface PortalSession extends UpstreamUser {
  systemId: string;
}

// Audiences distintas impedem usar um token de download como sessão e vice-versa.
export const SESSION_AUDIENCE = 'portal-apps:session';
export const DOWNLOAD_AUDIENCE = 'portal-apps:download';

interface SessionClaims {
  sub: string;
  sys: string;
  lvl: string;
  cid: string;
  opt: string;
  rol: string;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async issue(session: PortalSession): Promise<{ token: string; expiresAt: string }> {
    const claims: SessionClaims = {
      sub: session.username,
      sys: session.systemId,
      lvl: session.aliasLevel,
      cid: session.customerId,
      opt: session.operatorType,
      rol: session.role,
    };
    const token = await this.jwt.signAsync(claims, {
      audience: SESSION_AUDIENCE,
      expiresIn: this.config.sessionTtlSeconds,
    });
    const expiresAt = new Date(Date.now() + this.config.sessionTtlSeconds * 1000).toISOString();
    return { token, expiresAt };
  }

  async verify(token: string): Promise<PortalSession> {
    const c = await this.jwt.verifyAsync<SessionClaims>(token, { audience: SESSION_AUDIENCE });
    return {
      username: c.sub,
      systemId: c.sys,
      aliasLevel: c.lvl,
      customerId: c.cid,
      operatorType: c.opt,
      role: c.rol,
    };
  }
}

type RequestWithSession = Request & { portalSession?: PortalSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithSession>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException({ code: 'SESSION_REQUIRED', message: 'Faça login para continuar' });
    }
    try {
      req.portalSession = await this.sessions.verify(token);
    } catch {
      throw new UnauthorizedException({ code: 'SESSION_EXPIRED', message: 'Sessão expirada. Faça login novamente.' });
    }
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): PortalSession => ctx.switchToHttp().getRequest<RequestWithSession>().portalSession!,
);
