export type SettlementStatus = 'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED' | 'REVERSED';
export type RegistryMessageStatus = 'QUEUED' | 'SENT' | 'ACKNOWLEDGED' | 'REJECTED' | 'RETRY';
export type ReconciliationStatus = 'OPEN' | 'MATCHED' | 'EXCEPTION' | 'RESOLVED';

export interface SettlementInstruction {
  settlementId: string;
  tradeId: string;
  buyerParticipantId: string;
  sellerParticipantId: string;
  seriesCode: string;
  compliancePeriod: number;
  quantity: number;
  cashAmount: number;
  settlementType: 'T0_DVP';
  status: SettlementStatus;
  rulesetId: string;
  correlationId: string;
  failureReason?: string;
  createdAt: string;
  processedAt?: string;
  settledAt?: string;
  failedAt?: string;
  reversedAt?: string;
  updatedAt: string;
}

export interface RegistryMessage {
  registryMessageId: string;
  settlementId: string;
  tradeId: string;
  messageType: 'TRANSFER_PTBAE_IND';
  status: RegistryMessageStatus;
  attemptCount: number;
  acknowledgedQuantity?: number;
  registryReference?: string;
  errorMessage?: string;
  correlationId: string;
  createdAt: string;
  sentAt?: string;
  acknowledgedAt?: string;
  rejectedAt?: string;
  updatedAt: string;
}

export interface SettlementReconciliation {
  reconciliationId: string;
  settlementId: string;
  registryMessageId: string;
  tradeId: string;
  status: ReconciliationStatus;
  expectedQuantity: number;
  registryQuantity?: number;
  expectedCash: number;
  settledCash?: number;
  registryReference?: string;
  exceptionReason?: string;
  rulesetId: string;
  correlationId: string;
  createdAt: string;
  reconciledAt?: string;
  resolvedAt?: string;
  updatedAt: string;
}

export interface SettlementLedgerEntry {
  ledgerEntryId: string;
  settlementId: string;
  tradeId: string;
  registryMessageId: string;
  reconciliationId: string;
  participantId: string;
  legType: 'UNIT' | 'CASH';
  delta: number;
  rulesetId: string;
  registryReference: string;
  correlationId: string;
  createdAt: string;
}

export interface SettlementBundle {
  settlement: SettlementInstruction;
  registryMessage: RegistryMessage;
  reconciliation: SettlementReconciliation;
  ledgerEntries: SettlementLedgerEntry[];
  finalized: boolean;
}
