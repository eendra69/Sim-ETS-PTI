import { ProductCatalogService } from './product-catalog.service';

describe('ProductCatalogService', () => {
  let service: ProductCatalogService;

  beforeEach(() => {
    service = new ProductCatalogService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('keeps vintage separate from the target compliance period', async () => {
    const vintages = await service.listVintages('PTBAE-IND', 2027);

    expect(vintages.map((item) => item.vintageYear)).toEqual([2024, 2025, 2026, 2027]);
    expect(vintages.every((item) => item.eligibility?.targetCompliancePeriod === 2027)).toBe(true);
  });

  it('partitions each vintage with a distinct fungibility key', async () => {
    const vintages = await service.listVintages('PTBAE-IND', 2027);
    const keys = vintages.map((item) => item.admission?.fungibilityKey);

    expect(new Set(keys).size).toBe(vintages.length);
    expect(vintages.every((item) => item.admission?.crossVintageMatching === false)).toBe(true);
  });

  it('defaults to ineligible when no explicit vintage rule exists', async () => {
    await expect(service.evaluateEligibility('PTBAE-IND', 2025, 2026)).resolves.toMatchObject({
      vintageYear: 2025,
      targetCompliancePeriod: 2026,
      eligible: false,
      policySource: 'NO_RULE',
    });
  });

  it('maps participants to installation and trader scopes', async () => {
    await expect(service.listInstallations('IND-D')).resolves.toEqual([
      expect.objectContaining({ participantId: 'IND-D', installationId: 'INST-D-01' }),
    ]);
    await expect(service.listTraderScopes('TA-D-001', 'IND-D')).resolves.toEqual([
      expect.objectContaining({ traderAccountId: 'TA-D-001', installationId: 'INST-D-01' }),
    ]);
  });

  it('does not make a provisional holding tradable even when its vintage is eligible', async () => {
    const holdings = await service.listHoldings({
      participantId: 'IND-C',
      seriesCode: 'PTBAE-IND',
      vintageYear: 2026,
      targetCompliancePeriod: 2027,
    });

    expect(holdings).toEqual([
      expect.objectContaining({
        vintageYear: 2026,
        targetCompliancePeriod: 2027,
        eligibleForTargetPeriod: true,
        sourceStatus: 'PROVISIONAL',
        availableUnits: 40_000,
        tradableAvailableUnits: 0,
      }),
    ]);
  });
});

