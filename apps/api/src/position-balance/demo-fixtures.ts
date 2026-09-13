import {
  AnnualPositionInput,
  BalanceAccount,
  BASELINE_PERIOD,
  BASELINE_SERIES,
} from './position.types';

const defaults = {
  seriesCode: BASELINE_SERIES,
  compliancePeriod: BASELINE_PERIOD,
  acknowledgedPurchases: 0,
  acknowledgedSales: 0,
  eligibleBankedUnits: 0,
  eligibleOffsetApplied: 0,
  sourceStatus: 'VERIFIED' as const,
  dataOrigin: 'UNSPECIFIED' as const,
  sourceReference: 'DEMO-FIXTURE',
};

export const demoPositions: AnnualPositionInput[] = [
  {
    ...defaults,
    participantId: 'IND-A',
    participantName: 'Industri A',
    allocatedQuota: 1_200_000,
    verifiedEmission: 1_170_000,
  },
  {
    ...defaults,
    participantId: 'IND-B',
    participantName: 'Industri B',
    allocatedQuota: 2_100_000,
    verifiedEmission: 2_050_000,
  },
  {
    ...defaults,
    participantId: 'IND-C',
    participantName: 'Industri C',
    allocatedQuota: 900_000,
    verifiedEmission: 860_000,
  },
  {
    ...defaults,
    participantId: 'IND-D',
    participantName: 'Industri D',
    allocatedQuota: 1_500_000,
    verifiedEmission: 1_560_000,
  },
];

export const demoBalances: BalanceAccount[] = demoPositions.map((position) => ({
  participantId: position.participantId,
  seriesCode: position.seriesCode,
  compliancePeriod: position.compliancePeriod,
  eligibleHolding: position.allocatedQuota,
  lockedUnits: 0,
  surrenderedUnits: 0,
  reservedSell: 0,
  executedSellPending: 0,
  buyingCapacity: 10_000_000_000,
  reservedBuyFunds: 0,
  reservedBuyQuantity: 0,
  executedBuyPending: 0,
  executedBuyPendingFunds: 0,
  version: 1,
}));
