export type PolicyCertainty = 'OFFICIAL' | 'FIXED_PROJECT' | 'SIMULATION_ASSUMPTION';
export type CatalogueStatus = 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'PLANNED';

export interface ProductSeriesCatalogueItem {
  seriesCode: string;
  unit: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
}

export interface ProductAdmission {
  productAdmissionId: string;
  seriesCode: string;
  vintageYear: number;
  marketSegment: 'REGULAR';
  fungibilityKey: string;
  crossVintageMatching: boolean;
  status: CatalogueStatus;
  effectiveFrom: string;
  expiresAt?: string;
  policySource: string;
  policyCertainty: PolicyCertainty;
}

export interface VintageEligibility {
  productAdmissionId: string;
  seriesCode: string;
  vintageYear: number;
  targetCompliancePeriod: number;
  eligible: boolean;
  usagePriority: number;
  reason: string;
  policySource: string;
  policyCertainty: PolicyCertainty | 'UNSPECIFIED';
}

export interface QuotaVintage {
  vintageId: string;
  seriesCode: string;
  vintageYear: number;
  displayLabel: string;
  effectiveFrom: string;
  expiresAt?: string;
  bankingStatus: 'CURRENT_YEAR' | 'BANKED_AVAILABLE' | 'RESTRICTED' | 'EXPIRED' | 'PLAN_SEED';
  status: CatalogueStatus;
  policySource: string;
  policyCertainty: PolicyCertainty;
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
  eligibleForTargetPeriod?: boolean;
  targetCompliancePeriod?: number;
  tradableAvailableUnits: number;
  sourceStatus: 'PROJECTED' | 'PROVISIONAL' | 'VERIFIED';
  status: 'ACTIVE' | 'LOCKED' | 'EXHAUSTED';
  dataOrigin: 'UNSPECIFIED' | 'OFFICIAL' | 'SYNTHETIC';
  provenanceType: 'ALLOCATION' | 'TRADE_RECEIPT' | 'MIGRATED_AGGREGATE' | 'SYNTHETIC_DERIVED';
  sourceReference?: string;
  version: number;
}

