/**
 * Bearer-token guards. `@Public()` opts an endpoint out entirely; the partner
 * guard additionally re-checks device binding on every request, so revoking a
 * device takes effect immediately rather than at token expiry.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { PrismaClient } from '@pipefix/db';
import { ForbiddenError, UnauthorizedError } from '@pipefix/shared';
import { PRISMA } from '../env';
import { TokenService, type AccessClaims } from './token.service';

export const IS_PUBLIC = 'pipefix:isPublic';
export const Public = (): MethodDecorator => SetMetadata(IS_PUBLIC, true);

export interface AuthedRequest extends Request {
  auth?: AccessClaims;
}

/** `@Caller() caller: AccessClaims` in a handler signature. */
export const Caller = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessClaims => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (req.auth === undefined) throw new UnauthorizedError('Authentication required.');
    return req.auth;
  },
);

function bearer(req: Request): string {
  const header = req.headers.authorization;
  if (header === undefined || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Authentication required.');
  }
  return header.slice('Bearer '.length);
}

@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = this.tokens.verifyAccess(bearer(req));
    if (claims.typ !== 'CUSTOMER') throw new ForbiddenError('This endpoint is for customers.');
    req.auth = claims;
    return true;
  }
}

@Injectable()
export class PartnerGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const claims = this.tokens.verifyAccess(bearer(req));
    if (claims.typ !== 'PARTNER') throw new ForbiddenError('This endpoint is for partners.');

    const partner = await this.prisma.partner.findUnique({ where: { id: claims.sub } });
    if (partner === null || partner.status !== 'ACTIVE') {
      throw new ForbiddenError('Your partner account is not active.');
    }
    if (partner.deviceId !== null && partner.deviceId !== claims.did) {
      throw new UnauthorizedError('You are signed in on another device. Please sign in again.');
    }

    req.auth = claims;
    return true;
  }
}
