import { CanActivate, ExecutionContext, Injectable, Logger, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';

export const Public = () => SetMetadata('isPublic', true);

/** Single-user API: the desktop app sends `Authorization: Bearer <APP_API_TOKEN>`. */
@Injectable()
export class TokenGuard implements CanActivate {
  private readonly logger = new Logger(TokenGuard.name);
  private warned = false;

  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>('isPublic', [ctx.getHandler(), ctx.getClass()])) return true;
    const expected = process.env.APP_API_TOKEN;
    if (!expected) {
      if (process.env.NODE_ENV === 'production') throw new UnauthorizedException('APP_API_TOKEN is not configured');
      if (!this.warned) {
        this.logger.warn('APP_API_TOKEN not set — API is unauthenticated (dev only).');
        this.warned = true;
      }
      return true;
    }
    const header: string | undefined = ctx.switchToHttp().getRequest().headers['authorization'];
    const given = header?.startsWith('Bearer ') ? header.slice(7) : '';
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedException();
    return true;
  }
}
