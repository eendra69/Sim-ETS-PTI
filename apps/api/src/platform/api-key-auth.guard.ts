import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { AuthenticatedRequest, ApiIdentity, ApplicationRole } from './auth.types';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

interface ApiKeyRecord extends ApiIdentity {
  apiKey: string;
}

const VALID_ROLES = new Set<ApplicationRole>([
  'ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR',
]);

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) {
      return true;
    }
    if ((process.env.AUTH_MODE ?? 'disabled') === 'disabled') return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const supplied = request.header('x-api-key');
    if (!supplied) throw new UnauthorizedException('x-api-key is required');

    const record = this.records().find((candidate) => this.safeEqual(candidate.apiKey, supplied));
    if (!record) throw new UnauthorizedException('API key is invalid');
    request.identity = {
      actorId: record.actorId,
      roles: record.roles,
      ...(record.participantId ? { participantId: record.participantId } : {}),
    };

    const required = this.reflector.getAllAndOverride<ApplicationRole[]>(ROLES_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (required?.length && !record.roles.some((role) => required.includes(role))) {
      throw new ForbiddenException('Identity does not have a required role');
    }
    return true;
  }

  private records(): ApiKeyRecord[] {
    let value: unknown;
    try {
      value = JSON.parse(process.env.API_KEYS_JSON ?? '[]');
    } catch {
      throw new Error('API_KEYS_JSON must be valid JSON');
    }
    if (!Array.isArray(value)) throw new Error('API_KEYS_JSON must be an array');
    return value.map((item) => {
      const record = item as Partial<ApiKeyRecord>;
      if (
        typeof record.apiKey !== 'string' || record.apiKey.length < 16 ||
        typeof record.actorId !== 'string' || record.actorId.length < 2 ||
        !Array.isArray(record.roles) ||
        record.roles.some((role) => !VALID_ROLES.has(role))
      ) {
        throw new Error('API_KEYS_JSON contains an invalid identity');
      }
      return record as ApiKeyRecord;
    });
  }

  private safeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
}
