import {
  Installation,
  ProductAdmission,
  ProductSeriesCatalogueItem,
  QuotaVintage,
  TraderInstallationScope,
  VintageEligibility,
  VintageHolding,
} from './product-catalog.types';

export const catalogueSeries: ProductSeriesCatalogueItem[] = [
  { seriesCode: 'PTBAE-IND', unit: 'tCO2e', status: 'ACTIVE' },
];

const vintageDefinition = [
  [2024, 'BANKED_AVAILABLE', 'CARRYOVER_SIMULATION'],
  [2025, 'BANKED_AVAILABLE', 'CARRYOVER_SIMULATION'],
  [2026, 'CURRENT_YEAR', 'CURRENT_2026_SIMULATION'],
  [2027, 'PLAN_SEED', 'SOFTWARE_PLAN_V0.4_SEED'],
] as const;

export const catalogueAdmissions: ProductAdmission[] = vintageDefinition.map(
  ([vintageYear, , policySource]) => ({
    productAdmissionId: `ADM-PTBAE-IND-V${vintageYear}-REG`,
    seriesCode: 'PTBAE-IND',
    vintageYear,
    marketSegment: 'REGULAR',
    fungibilityKey: `PTBAE-IND:V${vintageYear}:REG`,
    crossVintageMatching: false,
    status: 'ACTIVE',
    effectiveFrom: `${vintageYear}-01-01T00:00:00+07:00`,
    expiresAt: '2027-12-31T23:59:59+07:00',
    policySource,
    policyCertainty: 'SIMULATION_ASSUMPTION',
  }),
);

export const catalogueVintages: QuotaVintage[] = vintageDefinition.map(
  ([vintageYear, bankingStatus, policySource]) => ({
    vintageId: `VINT-PTBAE-IND-${vintageYear}`,
    seriesCode: 'PTBAE-IND',
    vintageYear,
    displayLabel: `PTBAE-IND - Vintage ${vintageYear}`,
    effectiveFrom: `${vintageYear}-01-01T00:00:00+07:00`,
    expiresAt: '2027-12-31T23:59:59+07:00',
    bankingStatus,
    status: 'ACTIVE',
    policySource,
    policyCertainty: 'SIMULATION_ASSUMPTION',
  }),
);

function eligibility(
  vintageYear: number,
  targetCompliancePeriod: number,
  usagePriority: number,
): VintageEligibility {
  const policySource = vintageYear < 2026
    ? 'CARRYOVER_SIMULATION'
    : vintageYear === 2026
      ? 'CURRENT_2026_SIMULATION'
      : 'SOFTWARE_PLAN_V0.4_SEED';
  return {
    productAdmissionId: `ADM-PTBAE-IND-V${vintageYear}-REG`,
    seriesCode: 'PTBAE-IND',
    vintageYear,
    targetCompliancePeriod,
    eligible: true,
    usagePriority,
    reason: `Vintage ${vintageYear} accepted for CP-${targetCompliancePeriod} in the simulator`,
    policySource,
    policyCertainty: 'SIMULATION_ASSUMPTION',
  };
}

export const catalogueEligibility: VintageEligibility[] = [
  eligibility(2024, 2026, 3),
  eligibility(2024, 2027, 3),
  eligibility(2025, 2027, 2),
  eligibility(2026, 2026, 1),
  eligibility(2026, 2027, 1),
  eligibility(2027, 2027, 1),
];

export const catalogueInstallations: Installation[] = ['A', 'B', 'C', 'D'].map((suffix) => ({
  installationId: `INST-${suffix}-01`,
  participantId: `IND-${suffix}`,
  participantName: `Industri ${suffix}`,
  installationName: `Industri ${suffix} - Instalasi 01`,
  status: 'ACTIVE',
  dataOrigin: 'UNSPECIFIED',
}));

export const catalogueTraderScopes: TraderInstallationScope[] = ['A', 'B', 'C', 'D'].map(
  (suffix) => ({
    traderAccountId: `TA-${suffix}-001`,
    participantId: `IND-${suffix}`,
    displayName: `Industri ${suffix} - Trader`,
    installationId: `INST-${suffix}-01`,
    status: 'ACTIVE',
  }),
);

export const catalogueHoldings: VintageHolding[] = [
  ['IND-A', 'INST-A-01', 2024, 30_000],
  ['IND-B', 'INST-B-01', 2025, 50_000],
  ['IND-C', 'INST-C-01', 2026, 40_000],
].map(([participantId, installationId, vintageYear, totalUnits]) => ({
  vintageHoldingId: `MEM-${participantId}-${vintageYear}`,
  participantId: String(participantId),
  installationId: String(installationId),
  seriesCode: 'PTBAE-IND',
  vintageYear: Number(vintageYear),
  totalUnits: Number(totalUnits),
  lockedUnits: 0,
  surrenderedUnits: 0,
  reservedSell: 0,
  executedSellPending: 0,
  availableUnits: Number(totalUnits),
  tradableAvailableUnits: Number(totalUnits),
  sourceStatus: vintageYear === 2026 ? 'PROVISIONAL' : 'VERIFIED',
  status: 'ACTIVE',
  dataOrigin: 'SYNTHETIC',
  provenanceType: 'SYNTHETIC_DERIVED',
  sourceReference: `DEMO-VINTAGE-${vintageYear}`,
  version: 1,
}));

