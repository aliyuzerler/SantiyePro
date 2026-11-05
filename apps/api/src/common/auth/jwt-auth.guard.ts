import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { JwtService } from './jwt.service.js';
import { IS_PUBLIC_KEY, type AuthenticatedUser } from './decorators.js';

/**
 * Kimlik doğrulama guard'ı — deny-by-default:
 * @Public() işaretli uçlar dışında Bearer access token zorunludur.
 * Global APP_GUARD olarak takılır (app.module).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Kimlik doğrulaması gerekli' });
    }
    const payload = await this.jwtService.verifyAccessToken(token);
    if (!payload) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Oturum geçersiz veya süresi doldu' });
    }
    req.user = { userId: payload.sub, email: payload.email };
    return true;
  }
}
