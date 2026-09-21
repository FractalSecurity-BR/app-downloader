import { Body, Controller, HttpCode, HttpStatus, Inject, Logger, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { APP_CONFIG, AppConfig } from '../config/app-config';
import { canSeeTestBuilds } from '../apps/visibility';
import { SystemsService } from '../systems/systems.service';
import { SessionService } from './session';
import { upstreamLogin } from './upstream-login';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  system: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  username: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string;
}

@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly systems: SystemsService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginDto) {
    const system = this.systems.get(dto.system);
    // Mesma normalização do /auth/login dos sistemas.
    const username = dto.username.trim().toLowerCase();

    try {
      const user = await upstreamLogin(system, username, dto.password, this.config.upstreamTimeoutMs);
      const session = { ...user, systemId: system.id };
      const { token, expiresAt } = await this.sessions.issue(session);
      this.logger.log(`login ok user=${user.username} system=${system.id} level=${user.aliasLevel}`);
      return {
        token,
        expiresAt,
        user: { username: user.username, profile: user.aliasLevel, canSeeTestBuilds: canSeeTestBuilds(session) },
        system: { id: system.id, name: system.name },
      };
    } catch (err: any) {
      this.logger.warn(`login falhou user=${username} system=${system.id} code=${err?.response?.code ?? err?.message}`);
      throw err;
    }
  }
}
