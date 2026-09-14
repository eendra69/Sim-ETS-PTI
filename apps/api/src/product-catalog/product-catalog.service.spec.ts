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

  it('accepts an order context only when installation, eligibility, and vintage holding align', async () => {
    await expect(service.assertOrderContext({
      participantId: 'IND-A',
      installationId: 'INST-A-01',
      seriesCode: 'PTBAE-IND',
      vintageYear: 2024,
      targetCompliancePeriod: 2027,
      side: 'SELL',
      quantity: 10_000,
    })).resolves.toBeUndefined();

    await expect(service.assertOrderContext({
      participantId: 'IND-A',
      installationId: 'INST-B-01',
      seriesCode: 'PTBAE-IND',
      vintageYear: 2024,
      targetCompliancePeriod: 2027,
      side: 'SELL',
      quantity: 10_000,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CAT-INSTALLATION-SCOPE' }) });

    await expect(service.assertOrderContext({
      participantId: 'IND-A',
      installationId: 'INST-A-01',
      seriesCode: 'PTBAE-IND',
      vintageYear: 2025,
      targetCompliancePeriod: 2026,
      side: 'BUY',
      quantity: 10_000,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CAT-VINTAGE-INELIGIBLE' }) });
  });

  it('rejects a sell order that exceeds the verified holding for its exact vintage', async () => {
    await expect(service.assertOrderContext({
      participantId: 'IND-A',
      installationId: 'INST-A-01',
      seriesCode: 'PTBAE-IND',
      vintageYear: 2024,
      targetCompliancePeriod: 2027,
      side: 'SELL',
      quantity: 30_001,
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CAT-INSUFFICIENT-VINTAGE-HOLDING' }),
    });
  });
});
