export interface PositionSnapshot {
  participantId: string;
  participantName: string;
  allocatedQuota: number;
  verifiedEmission: number;
  netPosition: number;
  positionStatus: 'SURPLUS' | 'DEFICIT' | 'BALANCED';
  availableToSell: number;
  buyNeedRemaining: number;
  availableBuyNeed: number;
  acknowledgedPurchases: number;
  acknowledgedSales: number;
  executedSellPending: number;
  executedBuyPending: number;
  sourceStatus: 'PROJECTED' | 'PROVISIONAL' | 'VERIFIED';
  dataOrigin: 'UNSPECIFIED' | 'OFFICIAL' | 'SYNTHETIC';
  sourceReference?: string;
  businessType?: string;
  scaleClass?: 'SMALL' | 'MEDIUM' | 'LARGE';
}
export interface LimitOrder {
  orderId: string;
  participantId: string;
  installationId: string;
  vintageYear: number;
  side: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET';
  remainingQuantity: number;
  limitPrice?: number;
  protectionPrice?: number;
  timeInForce: 'DAY' | 'GTC' | 'IOC';
  status: 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED' | 'CANCELLED_REMAINDER';
}

export interface StopOrder {
  orderId: string;
  participantId: string;
  installationId: string;
  vintageYear: number;
  side: 'BUY' | 'SELL';
  orderType: 'STOP';
  remainingQuantity: number;
  stopPrice: number;
  protectionPrice: number;
  timeInForce: 'DAY' | 'GTC';
  status: 'TRIGGER_PENDING' | 'ACTIVATED' | 'CANCELLED' | 'EXPIRED' | 'ACTIVATION_FAILED';
}

export interface Trade {
  tradeId: string;
  buyerParticipantId: string;
  sellerParticipantId: string;
  buyerInstallationId: string;
  sellerInstallationId: string;
  vintageYear: number;
  quantity: number;
  price: number;
  notional: number;
  tradeSequence: number;
  executedAt: string;
}

export interface BookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface OrderBook {
  vintageYear?: number;
  bids: BookLevel[];
  asks: BookLevel[];
  orders: { bids: LimitOrder[]; asks: LimitOrder[] };
}

export interface TriggerBook {
  vintageYear?: number;
  entries: StopOrder[];
}

export interface MarketDataSnapshot {
  vintageYear?: number;
  state: 'NO_TRADES' | 'TRADING';
  referencePrice: number;
  lastTradedPrice: number | null;
  topOfBook: {
    bestBid: BookLevel | null;
    bestAsk: BookLevel | null;
    spread: number | null;
  };
  statistics: {
    tradeCount: number;
    volume: number;
    notional: number;
    vwap: number | null;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
  };
}

export interface SettlementBundle {
  settlement: {
    settlementId: string;
    tradeId: string;
    buyerParticipantId: string;
    sellerParticipantId: string;
    buyerInstallationId: string;
    sellerInstallationId: string;
    vintageYear: number;
    status: 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'REVERSED';
    quantity: number;
    cashAmount: number;
    failureReason?: string;
  };
  registryMessage: {
    registryMessageId: string;
    status: 'QUEUED' | 'SENT' | 'ACKNOWLEDGED' | 'REJECTED' | 'RETRY';
    attemptCount: number;
    registryReference?: string;
    errorMessage?: string;
  };
  reconciliation: {
    status: 'OPEN' | 'MATCHED' | 'EXCEPTION' | 'RESOLVED';
    exceptionReason?: string;
  };
  finalized: boolean;
}

export interface GovernedRuleset {
  rulesetId: string;
  seriesCode: string;
  compliancePeriod: number;
  version: number;
  status: 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
  referencePrice: number;
  minimumPrice: number;
  maximumPrice: number;
  tickSize: number;
  lotSize: number;
  marketSessionId: string;
  sellCapPercentage: number;
  settlementFinality: 'DVP_SETTLED' | 'SRUK_ACK_RECONCILED';
  surveillancePriceDeviationBps: number;
  surveillanceVolumeThreshold: number;
  repeatedCancelThreshold: number;
}

export interface MarketSession {
  sessionId: string;
  status: 'OPEN' | 'HALTED' | 'CLOSED';
  rulesetId: string;
}

export interface AuditEvent {
  auditEventId: string;
  eventSequence: number;
  eventType: string;
  entityType: string;
  actorId: string;
  correlationId: string;
  occurredAt: string;
}

export interface SurveillanceAlert {
  alertId: string;
  alertSequence: number;
  alertType: string;
  severity: string;
  description: string;
  status: string;
}

export interface ScenarioDefinition {
  scenarioId: string;
  name: string;
  rulesetId: string;
}

export interface ScenarioRun {
  runId: string;
  scenarioId: string;
  runNumber: number;
  resultHash: string;
  isDeterministicMatch?: boolean;
  result: { finalPositions: Record<string, number>; events: unknown[] };
}

export interface ProductAdmission {
  productAdmissionId: string;
  seriesCode: string;
  vintageYear: number;
  marketSegment: 'REGULAR';
  fungibilityKey: string;
  crossVintageMatching: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PLANNED';
  effectiveFrom: string;
  expiresAt?: string;
  policySource: string;
  policyCertainty: 'OFFICIAL' | 'FIXED_PROJECT' | 'SIMULATION_ASSUMPTION';
}

export interface VintageEligibility {
  vintageYear: number;
  targetCompliancePeriod: number;
  eligible: boolean;
  usagePriority: number;
  reason: string;
  policySource: string;
  policyCertainty: 'OFFICIAL' | 'FIXED_PROJECT' | 'SIMULATION_ASSUMPTION' | 'UNSPECIFIED';
}

export interface QuotaVintage {
  vintageId: string;
  seriesCode: string;
  vintageYear: number;
  displayLabel: string;
  effectiveFrom: string;
  expiresAt?: string;
  bankingStatus: 'CURRENT_YEAR' | 'BANKED_AVAILABLE' | 'RESTRICTED' | 'EXPIRED' | 'PLAN_SEED';
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PLANNED';
  policySource: string;
  policyCertainty: 'OFFICIAL' | 'FIXED_PROJECT' | 'SIMULATION_ASSUMPTION';
  admission?: ProductAdmission;
  eligibility?: VintageEligibility;
}

export interface Installation {
  installationId: string;
  participantId: string;
  participantName: string;
  installationName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';
  dataOrigin: 'UNSPECIFIED' | 'OFFICIAL' | 'SYNTHETIC';
}

export interface TraderInstallationScope {
  traderAccountId: string;
  participantId: string;
  displayName: string;
  installationId: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface ProductSeriesCatalogueItem {
  seriesCode: string;
  unit: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}

export interface VintageHolding {
  vintageHoldingId: string;
  participantId: string;
  installationId: string;
  seriesCode: string;
  vintageYear: number;
  totalUnits: number;
  lockedUnits: number;
  surrenderedUnits: number;
  reservedSell: number;
  executedSellPending: number;
  availableUnits: number;
  tradableAvailableUnits: number;
  eligibleForTargetPeriod?: boolean;
  targetCompliancePeriod?: number;
  sourceStatus: 'PROJECTED' | 'PROVISIONAL' | 'VERIFIED';
  status: 'ACTIVE' | 'LOCKED' | 'EXHAUSTED';
  dataOrigin: 'UNSPECIFIED' | 'OFFICIAL' | 'SYNTHETIC';
  provenanceType: 'ALLOCATION' | 'TRADE_RECEIPT' | 'MIGRATED_AGGREGATE' | 'SYNTHETIC_DERIVED';
  sourceReference?: string;
  version: number;
}
