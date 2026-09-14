import { Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { Pool, QueryResultRow } from 'pg';
import {
  catalogueAdmissions,
  catalogueEligibility,
  catalogueHoldings,
  catalogueInstallations,
  catalogueSeries,
  catalogueTraderScopes,
  catalogueVintages,
} from './product-catalog.fixtures';
import {
  Installation,
  ProductAdmission,
  ProductSeriesCatalogueItem,
  QuotaVintage,
  TraderInstallationScope,
  VintageEligibility,
  VintageHolding,
} from './product-catalog.types';

interface SeriesRow extends QueryResultRow {
  series_code: string;
  unit: string;
  status: ProductSeriesCatalogueItem['status'];
}

interface VintageRow extends QueryResultRow {
  vintage_id: string;
  series_code: string;
  vintage_year: number;
  display_label: string;
  effective_from: Date;
  expires_at: Date | null;
  banking_status: QuotaVintage['bankingStatus'];
  vintage_status: QuotaVintage['status'];
  vintage_policy_source: string;
  vintage_policy_certainty: QuotaVintage['policyCertainty'];
  product_admission_id: string | null;
  market_segment: 'REGULAR' | null;
  fungibility_key: string | null;
  cross_vintage_matching: boolean | null;
  admission_status: ProductAdmission['status'] | null;
  admission_effective_from: Date | null;
  admission_expires_at: Date | null;
  admission_policy_source: string | null;
  admission_policy_certainty: ProductAdmission['policyCertainty'] | null;
  target_compliance_period: number | null;
  eligible: boolean | null;
  usage_priority: number | null;
  eligibility_reason: string | null;
  eligibility_policy_source: string | null;
  eligibility_policy_certainty: VintageEligibility['policyCertainty'] | null;
}

interface AdmissionRow extends QueryResultRow {
  product_admission_id: string;
  series_code: string;
  vintage_year: number;
  market_segment: 'REGULAR';
  fungibility_key: string;
  cross_vintage_matching: boolean;
  status: ProductAdmission['status'];
  effective_from: Date;
  expires_at: Date | null;
  policy_source: string;
  policy_certainty: ProductAdmission['policyCertainty'];
}

interface InstallationRow extends QueryResultRow {
  installation_id: string;
  participant_id: string;
  participant_name: string;
  installation_name: string;
  status: Installation['status'];
  data_origin: Installation['dataOrigin'];
}

interface TraderScopeRow extends QueryResultRow {
  trader_account_id: string;
  participant_id: string;
  display_name: string;
  installation_id: string;
  status: TraderInstallationScope['status'];
}

interface HoldingRow extends QueryResultRow {
  vintage_holding_id: string;
  participant_id: string;
  installation_id: string;
  series_code: string;
  vintage_year: number;
  total_units: string;
  locked_units: string;
  surrendered_units: string;
  reserved_sell: string;
  executed_sell_pending: string;
  source_status: VintageHolding['sourceStatus'];
  status: VintageHolding['status'];
  data_origin: VintageHolding['dataOrigin'];
  provenance_type: VintageHolding['provenanceType'];
  source_reference: string | null;
  version: number;
  eligible_for_target_period: boolean | null;
}

@Injectable()
export class ProductCatalogService implements OnModuleDestroy {
  private readonly pool?: Pool;

  constructor() {
    const usePostgres = process.env.NODE_ENV !== 'test' && process.env.PERSISTENCE_MODE === 'postgres';
    if (!usePostgres) return;
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
    }
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async listSeries(): Promise<ProductSeriesCatalogueItem[]> {
    if (!this.pool) return structuredClone(catalogueSeries);
    const result = await this.pool.query<SeriesRow>(
      'SELECT series_code, unit, status FROM product_series ORDER BY series_code',
    );
    return result.rows.map((row) => ({
      seriesCode: row.series_code,
      unit: row.unit,
      status: row.status,
    }));
  }

  async listVintages(seriesCode?: string, targetCompliancePeriod?: number): Promise<QuotaVintage[]> {
    if (!this.pool) {
      return catalogueVintages
        .filter((item) => !seriesCode || item.seriesCode === seriesCode)
        .map((item) => this.decorateMemoryVintage(item, targetCompliancePeriod));
    }

    const result = await this.pool.query<VintageRow>(
      `SELECT
         q.vintage_id, q.series_code, q.vintage_year, q.display_label,
         q.effective_from, q.expires_at, q.banking_status, q.status AS vintage_status,
         q.policy_source AS vintage_policy_source,
         q.policy_certainty AS vintage_policy_certainty,
         pa.product_admission_id, pa.market_segment, pa.fungibility_key,
         pa.cross_vintage_matching, pa.status AS admission_status,
         pa.effective_from AS admission_effective_from,
         pa.expires_at AS admission_expires_at,
         pa.policy_source AS admission_policy_source,
         pa.policy_certainty AS admission_policy_certainty,
         er.target_compliance_period, er.eligible, er.usage_priority,
         er.reason AS eligibility_reason,
         er.policy_source AS eligibility_policy_source,
         er.policy_certainty AS eligibility_policy_certainty
       FROM quota_vintages q
       LEFT JOIN product_admissions pa
         ON pa.series_code=q.series_code AND pa.vintage_year=q.vintage_year
        AND pa.market_segment='REGULAR'
       LEFT JOIN vintage_eligibility_rules er
         ON er.product_admission_id=pa.product_admission_id
        AND er.target_compliance_period=$2
       WHERE ($1::text IS NULL OR q.series_code=$1)
       ORDER BY q.series_code, q.vintage_year`,
      [seriesCode ?? null, targetCompliancePeriod ?? null],
    );
    return result.rows.map((row) => this.mapVintage(row, targetCompliancePeriod));
  }

  async getVintage(vintageId: string, targetCompliancePeriod?: number): Promise<QuotaVintage> {
    const result = (await this.listVintages(undefined, targetCompliancePeriod))
      .find((item) => item.vintageId === vintageId);
    if (!result) throw new NotFoundException(`Quota vintage ${vintageId} was not found`);
    return result;
  }

  async listAdmissions(seriesCode?: string, vintageYear?: number): Promise<ProductAdmission[]> {
    if (!this.pool) {
      return catalogueAdmissions
        .filter((item) => (!seriesCode || item.seriesCode === seriesCode) &&
          (!vintageYear || item.vintageYear === vintageYear))
        .map((item) => structuredClone(item));
    }
    const result = await this.pool.query<AdmissionRow>(
      `SELECT * FROM product_admissions
       WHERE ($1::text IS NULL OR series_code=$1)
         AND ($2::integer IS NULL OR vintage_year=$2)
       ORDER BY series_code, vintage_year, market_segment`,
      [seriesCode ?? null, vintageYear ?? null],
    );
    return result.rows.map((row) => this.mapAdmission(row));
  }

  async evaluateEligibility(
    seriesCode: string,
    vintageYear: number,
    targetCompliancePeriod: number,
  ): Promise<VintageEligibility> {
    const vintage = (await this.listVintages(seriesCode, targetCompliancePeriod))
      .find((item) => item.vintageYear === vintageYear);
    if (!vintage) {
      throw new NotFoundException(`Quota vintage ${seriesCode}/${vintageYear} was not found`);
    }
    return vintage.eligibility ?? this.ineligibleFallback(vintage, targetCompliancePeriod);
  }

  async listInstallations(participantId?: string): Promise<Installation[]> {
    if (!this.pool) {
      return catalogueInstallations
        .filter((item) => !participantId || item.participantId === participantId)
        .map((item) => structuredClone(item));
    }
    const result = await this.pool.query<InstallationRow>(
      `SELECT i.installation_id, i.participant_id, p.legal_name AS participant_name,
              i.installation_name, i.status, i.data_origin
       FROM installations i
       JOIN participants p ON p.participant_id=i.participant_id
       WHERE ($1::text IS NULL OR i.participant_id=$1)
       ORDER BY i.participant_id, i.installation_id`,
      [participantId ?? null],
    );
    return result.rows.map((row) => ({
      installationId: row.installation_id,
      participantId: row.participant_id,
      participantName: row.participant_name,
      installationName: row.installation_name,
      status: row.status,
      dataOrigin: row.data_origin,
    }));
  }

  async listTraderScopes(
    traderAccountId?: string,
    participantId?: string,
  ): Promise<TraderInstallationScope[]> {
    if (!this.pool) {
      return catalogueTraderScopes
        .filter((item) => (!traderAccountId || item.traderAccountId === traderAccountId) &&
          (!participantId || item.participantId === participantId))
        .map((item) => structuredClone(item));
    }
    const result = await this.pool.query<TraderScopeRow>(
      `SELECT t.trader_account_id, t.participant_id, t.display_name,
              s.installation_id, s.status
       FROM trader_installation_scopes s
       JOIN trader_accounts t ON t.trader_account_id=s.trader_account_id
       WHERE ($1::text IS NULL OR t.trader_account_id=$1)
         AND ($2::text IS NULL OR t.participant_id=$2)
       ORDER BY t.trader_account_id, s.installation_id`,
      [traderAccountId ?? null, participantId ?? null],
    );
    return result.rows.map((row) => ({
      traderAccountId: row.trader_account_id,
      participantId: row.participant_id,
      displayName: row.display_name,
      installationId: row.installation_id,
      status: row.status,
    }));
  }

  async listHoldings(filters: {
    participantId?: string;
    installationId?: string;
    seriesCode?: string;
    vintageYear?: number;
    targetCompliancePeriod?: number;
  }): Promise<VintageHolding[]> {
    if (!this.pool) return this.listMemoryHoldings(filters);

    const result = await this.pool.query<HoldingRow>(
      `SELECT h.*,
              CASE WHEN $5::integer IS NULL THEN NULL ELSE COALESCE(er.eligible, false) END
                AS eligible_for_target_period
       FROM vintage_holdings h
       LEFT JOIN product_admissions pa
         ON pa.series_code=h.series_code AND pa.vintage_year=h.vintage_year
        AND pa.market_segment='REGULAR'
       LEFT JOIN vintage_eligibility_rules er
         ON er.product_admission_id=pa.product_admission_id
        AND er.target_compliance_period=$5
       WHERE ($1::text IS NULL OR h.participant_id=$1)
         AND ($2::text IS NULL OR h.installation_id=$2)
         AND ($3::text IS NULL OR h.series_code=$3)
         AND ($4::integer IS NULL OR h.vintage_year=$4)
       ORDER BY h.participant_id, h.installation_id, h.series_code, h.vintage_year`,
      [
        filters.participantId ?? null,
        filters.installationId ?? null,
        filters.seriesCode ?? null,
        filters.vintageYear ?? null,
        filters.targetCompliancePeriod ?? null,
      ],
    );
    return result.rows.map((row) => this.mapHolding(row, filters.targetCompliancePeriod));
  }

  private decorateMemoryVintage(item: QuotaVintage, target?: number): QuotaVintage {
    const admission = catalogueAdmissions.find((candidate) =>
      candidate.seriesCode === item.seriesCode && candidate.vintageYear === item.vintageYear);
    const eligibility = target === undefined
      ? undefined
      : catalogueEligibility.find((candidate) =>
        candidate.seriesCode === item.seriesCode && candidate.vintageYear === item.vintageYear &&
        candidate.targetCompliancePeriod === target) ?? this.ineligibleFallback(item, target);
    return {
      ...structuredClone(item),
      ...(admission ? { admission: structuredClone(admission) } : {}),
      ...(eligibility ? { eligibility: structuredClone(eligibility) } : {}),
    };
  }

  private ineligibleFallback(vintage: QuotaVintage, target: number): VintageEligibility {
    return {
      productAdmissionId: vintage.admission?.productAdmissionId ??
        `UNADMITTED-${vintage.seriesCode}-V${vintage.vintageYear}`,
      seriesCode: vintage.seriesCode,
      vintageYear: vintage.vintageYear,
      targetCompliancePeriod: target,
      eligible: false,
      usagePriority: 999,
      reason: 'No eligibility rule exists for this vintage and target compliance period',
      policySource: 'NO_RULE',
      policyCertainty: 'UNSPECIFIED',
    };
  }

  private listMemoryHoldings(filters: {
    participantId?: string;
    installationId?: string;
    seriesCode?: string;
    vintageYear?: number;
    targetCompliancePeriod?: number;
  }): VintageHolding[] {
    return catalogueHoldings
      .filter((item) => (!filters.participantId || item.participantId === filters.participantId) &&
        (!filters.installationId || item.installationId === filters.installationId) &&
        (!filters.seriesCode || item.seriesCode === filters.seriesCode) &&
        (!filters.vintageYear || item.vintageYear === filters.vintageYear))
      .map((item) => {
        const rule = filters.targetCompliancePeriod === undefined
          ? undefined
          : catalogueEligibility.find((candidate) =>
            candidate.seriesCode === item.seriesCode && candidate.vintageYear === item.vintageYear &&
            candidate.targetCompliancePeriod === filters.targetCompliancePeriod);
        const eligible = filters.targetCompliancePeriod === undefined ? undefined : Boolean(rule?.eligible);
        const availableUnits = Math.max(
          0,
          item.totalUnits - item.lockedUnits - item.surrenderedUnits -
            item.reservedSell - item.executedSellPending,
        );
        return {
          ...structuredClone(item),
          availableUnits,
          ...(filters.targetCompliancePeriod === undefined
            ? {}
            : {
              targetCompliancePeriod: filters.targetCompliancePeriod,
              eligibleForTargetPeriod: eligible,
            }),
          tradableAvailableUnits:
            item.status === 'ACTIVE' && item.sourceStatus === 'VERIFIED' && eligible !== false
              ? availableUnits
              : 0,
        };
      });
  }

  private mapVintage(row: VintageRow, requestedTarget?: number): QuotaVintage {
    const admission = row.product_admission_id && row.market_segment && row.fungibility_key &&
      row.admission_status && row.admission_effective_from && row.admission_policy_source &&
      row.admission_policy_certainty
      ? {
        productAdmissionId: row.product_admission_id,
        seriesCode: row.series_code,
        vintageYear: row.vintage_year,
        marketSegment: row.market_segment,
        fungibilityKey: row.fungibility_key,
        crossVintageMatching: Boolean(row.cross_vintage_matching),
        status: row.admission_status,
        effectiveFrom: this.iso(row.admission_effective_from),
        ...(row.admission_expires_at ? { expiresAt: this.iso(row.admission_expires_at) } : {}),
        policySource: row.admission_policy_source,
        policyCertainty: row.admission_policy_certainty,
      } satisfies ProductAdmission
      : undefined;
    const base: QuotaVintage = {
      vintageId: row.vintage_id,
      seriesCode: row.series_code,
      vintageYear: row.vintage_year,
      displayLabel: row.display_label,
      effectiveFrom: this.iso(row.effective_from),
      ...(row.expires_at ? { expiresAt: this.iso(row.expires_at) } : {}),
      bankingStatus: row.banking_status,
      status: row.vintage_status,
      policySource: row.vintage_policy_source,
      policyCertainty: row.vintage_policy_certainty,
      ...(admission ? { admission } : {}),
    };
    if (requestedTarget === undefined) return base;
    const eligibility = row.target_compliance_period !== null && row.eligible !== null &&
      row.usage_priority !== null && row.eligibility_reason && row.eligibility_policy_source &&
      row.eligibility_policy_certainty
      ? {
        productAdmissionId: row.product_admission_id!,
        seriesCode: row.series_code,
        vintageYear: row.vintage_year,
        targetCompliancePeriod: row.target_compliance_period,
        eligible: row.eligible,
        usagePriority: row.usage_priority,
        reason: row.eligibility_reason,
        policySource: row.eligibility_policy_source,
        policyCertainty: row.eligibility_policy_certainty,
      } satisfies VintageEligibility
      : this.ineligibleFallback(base, requestedTarget);
    return { ...base, eligibility };
  }

  private mapAdmission(row: AdmissionRow): ProductAdmission {
    return {
      productAdmissionId: row.product_admission_id,
      seriesCode: row.series_code,
      vintageYear: row.vintage_year,
      marketSegment: row.market_segment,
      fungibilityKey: row.fungibility_key,
      crossVintageMatching: row.cross_vintage_matching,
      status: row.status,
      effectiveFrom: this.iso(row.effective_from),
      ...(row.expires_at ? { expiresAt: this.iso(row.expires_at) } : {}),
      policySource: row.policy_source,
      policyCertainty: row.policy_certainty,
    };
  }

  private mapHolding(row: HoldingRow, target?: number): VintageHolding {
    const totalUnits = this.number(row.total_units);
    const lockedUnits = this.number(row.locked_units);
    const surrenderedUnits = this.number(row.surrendered_units);
    const reservedSell = this.number(row.reserved_sell);
    const executedSellPending = this.number(row.executed_sell_pending);
    const availableUnits = Math.max(
      0,
      totalUnits - lockedUnits - surrenderedUnits - reservedSell - executedSellPending,
    );
    const eligible = target === undefined ? undefined : Boolean(row.eligible_for_target_period);
    return {
      vintageHoldingId: row.vintage_holding_id,
      participantId: row.participant_id,
      installationId: row.installation_id,
      seriesCode: row.series_code,
      vintageYear: row.vintage_year,
      totalUnits,
      lockedUnits,
      surrenderedUnits,
      reservedSell,
      executedSellPending,
      availableUnits,
      ...(target === undefined
        ? {}
        : { targetCompliancePeriod: target, eligibleForTargetPeriod: eligible }),
      tradableAvailableUnits:
        row.status === 'ACTIVE' && row.source_status === 'VERIFIED' && eligible !== false
          ? availableUnits
          : 0,
      sourceStatus: row.source_status,
      status: row.status,
      dataOrigin: row.data_origin,
      provenanceType: row.provenance_type,
      ...(row.source_reference ? { sourceReference: row.source_reference } : {}),
      version: row.version,
    };
  }

  private iso(value: Date): string {
    return value.toISOString();
  }

  private number(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`Unsafe database integer: ${value}`);
    return parsed;
  }
}

