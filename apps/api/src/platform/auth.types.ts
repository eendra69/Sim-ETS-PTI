import { Request } from 'express';

export type ApplicationRole =
  | 'ADMIN'
  | 'AUDITOR'
  | 'MARKET_OPERATOR'
  | 'SETTLEMENT_OPERATOR'
  | 'TRADER'
  | 'UAT_OPERATOR';

export interface ApiIdentity {
  actorId: string;
  roles: ApplicationRole[];
  participantId?: string;
}

export interface AuthenticatedRequest extends Request {
  identity?: ApiIdentity;
  correlationId?: string;
}

export function commandIdentity<T extends { actorId?: string; permissionContext?: string }>(
  dto: T,
  request: AuthenticatedRequest,
): T {
  if (!request.identity) return dto;
  return {
    ...dto,
    actorId: request.identity.actorId,
    permissionContext: request.identity.roles.join(','),
  };
}
