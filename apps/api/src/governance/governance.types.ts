import { MarketRuleset } from '../limit-order/limit-order.types';

export type GovernedRuleset = MarketRuleset;
export type MarketSessionStatus = 'OPEN' | 'HALTED' | 'CLOSED';

export interface MarketSession {
  sessionId: string;
  seriesCode: string;
  compliancePeriod: number;
  rulesetId: string;
  status: MarketSessionStatus;
  openedAt?: string;
  haltedAt?: string;
  resumedAt?: string;
  closedAt?: string;
  updatedAt: string;
}

export interface AuditEvent {
  auditEventId: string;
  eventSequence: number;
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string;
  permissionContext: string;
  beforeState?: unknown;
  afterState?: unknown;
  correlationId: string;
  causationId?: string;
  rulesetId?: string;
  occurredAt: string;
}

export type SurveillanceAlertType =
  | 'SELF_MATCH'
  | 'UNUSUAL_PRICE'
  | 'UNUSUAL_VOLUME'
  | 'REPEATED_CANCEL'
  | 'TRIGGER_ANOMALY';

export interface SurveillanceAlert {
  alertId: string;
  alertSequence: number;
  alertType: SurveillanceAlertType;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  participantId?: string;
  orderId?: string;
  tradeId?: string;
  triggerEventId?: string;
  description: string;
  evidence: Record<string, unknown>;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
  correlationId: string;
  rulesetId: string;
  createdAt: string;
}

export interface AuditEventInput {
  eventType: string;
  entityType: string;
  entityId: string;
  actorId: string;
  permissionContext: string;
  beforeState?: unknown;
  afterState?: unknown;
  correlationId: string;
  causationId?: string;
  rulesetId?: string;
}
