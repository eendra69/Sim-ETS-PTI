export const BASELINE_SERIES = 'PTBAE-IND';
export const BASELINE_PERIOD = 2027;

export interface AnnualPositionInput {
  participantId: string;
  participantName: string;
  seriesCode: string;
  compliancePeriod: number;
  allocatedQuota: number;
  verifiedEmission: number;
  acknowledgedPurchases: number;
  acknowledgedSales: number;
  eligibleBankedUnits: number;
  eligibleOffsetApplied: number;
}

export interface BalanceAccount {
  participantId: string;
  seriesCode: string;
  compliancePeriod: number;
  eligibleHolding: number;
  lockedUnits: number;
  surrenderedUnits: number;
  reservedSell: number;
  executedSellPending: number;
  buyingCapacity: number;
  reservedBuyFunds: number;
  reservedBuyQuantity: number;
  executedBuyPending: number;
  version: number;
}

export interface PositionSnapshot extends AnnualPositionInput {
  grossPosition: number;
  netPosition: number;
  positionStatus: 'SURPLUS' | 'DEFICIT' | 'BALANCED';
  verifiedSurplusRemaining: number;
  buyNeedRemaining: number;
  physicalTradableAvailable: number;
  maxSellQuantity: number;
  availableToSell: number;
  reservedSell: number;
  executedSellPending: number;
  buyingCapacity: number;
  reservedBuyFunds: number;
  availableBuyingCapacity: number;
  reservedBuyQuantity: number;
  executedBuyPending: number;
  availableBuyNeed: number;
  unit: 'tCO2e';
}

export type ReservationKind = 'SELL_QUOTA' | 'BUY_FUNDS';
export type ReservationStatus = 'ACTIVE' | 'RELEASED' | 'CONSUMED';

export interface BalanceReservation {
  reservationId: string;
  participantId: string;
  seriesCode: string;
  compliancePeriod: number;
  orderReference: string;
  kind: ReservationKind;
  quantity: number;
  amount: number;
  status: ReservationStatus;
  createdAt: string;
  releasedAt?: string;
}
