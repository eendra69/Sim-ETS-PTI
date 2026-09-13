import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(outputDir, '..', '..');
const years = [2024, 2025, 2026];
const scales = [
  { code: 'S', name: 'SMALL', multiplier: 1, buyingCapacity: 5_000_000_000 },
  { code: 'M', name: 'MEDIUM', multiplier: 3.2, buyingCapacity: 25_000_000_000 },
  { code: 'L', name: 'LARGE', multiplier: 9, buyingCapacity: 80_000_000_000 },
];
const variants = [
  { code: 'A', multiplier: 0.94, label: 'Efisiensi Tinggi' },
  { code: 'B', multiplier: 1.06, label: 'Beban Tinggi' },
];
const sectors = [
  { code: 'COAL', name: 'PEMBANGKIT_BATU_BARA', label: 'Pembangkit Batu Bara', base: 480_000, ratios: [1.01, 0.94], growth: [1, 1.015, 1.025], efficiency: 0.008, offset: 0.004 },
  { code: 'GAS', name: 'PEMBANGKIT_GAS', label: 'Pembangkit Gas', base: 270_000, ratios: [1.07, 0.99], growth: [1, 1.04, 1.08], efficiency: 0.012, offset: 0.006 },
  { code: 'CEM', name: 'SEMEN', label: 'Industri Semen', base: 210_000, ratios: [1.04, 0.95], growth: [1, 1.03, 1.055], efficiency: 0.015, offset: 0.008 },
  { code: 'STL', name: 'BESI_BAJA', label: 'Industri Besi dan Baja', base: 170_000, ratios: [1.03, 0.93], growth: [1, 0.99, 1.035], efficiency: 0.018, offset: 0.01 },
  { code: 'FRT', name: 'PUPUK_PETROKIMIA', label: 'Industri Pupuk dan Petrokimia', base: 135_000, ratios: [1.05, 0.97], growth: [1, 1.02, 1.04], efficiency: 0.01, offset: 0.009 },
  { code: 'PLP', name: 'PULP_KERTAS', label: 'Industri Pulp dan Kertas', base: 105_000, ratios: [1.1, 1.01], growth: [1, 1.015, 1.03], efficiency: 0.02, offset: 0.012 },
  { code: 'MFG', name: 'MANUFAKTUR_EFISIEN', label: 'Manufaktur Efisien', base: 48_000, ratios: [1.12, 1.04], growth: [1, 1.04, 1.075], efficiency: 0.025, offset: 0.015 },
];

let randomState = 20240914;
function random() {
  randomState = (1664525 * randomState + 1013904223) >>> 0;
  return randomState / 4294967296;
}
const roundLot = (value) => Math.max(0, Math.round(value / 1000) * 1000);
const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const toCsv = (headers, rows) => `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csvEscape(row[header])).join(',')).join('\n')}\n`;
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

const participants = [];
const sourceRows = [];
const expectedRows = [];

for (const sector of sectors) {
  for (const scale of scales) {
    for (let variantIndex = 0; variantIndex < variants.length; variantIndex += 1) {
      const variant = variants[variantIndex];
      const participantId = `SYN-${sector.code}-${scale.code}-${variant.code}`;
      const participantName = `Sintetis ${sector.label} ${scale.name} ${variant.code}`;
      const baseJitter = 0.96 + random() * 0.08;
      const baseEmission = roundLot(sector.base * scale.multiplier * variant.multiplier * baseJitter);
      participants.push({
        participant_id: participantId,
        legal_name: participantName,
        business_type: sector.name,
        scale_class: scale.name,
        operating_profile: variant.label,
        data_origin: 'SYNTHETIC',
        status: 'ACTIVE',
      });

      let priorNet = 0;
      for (const [yearIndex, year] of years.entries()) {
        const emission = roundLot(baseEmission * sector.growth[yearIndex] * ((1 - sector.efficiency) ** yearIndex));
        const tightening = 1 - yearIndex * 0.015;
        const adjustmentDirection = ((participants.length + yearIndex) % 5) - 2;
        const quotaAdjustment = adjustmentDirection * 1000;
        const preAdjustmentQuota = roundLot(emission * sector.ratios[variantIndex] * tightening);
        const allocatedQuota = Math.max(0, preAdjustmentQuota + quotaAdjustment);
        const eligibleBankedUnits = yearIndex === 0 ? 0 : roundLot(Math.max(0, priorNet) * (yearIndex === 1 ? 0.6 : 0.5));
        const deficitBeforeOffset = Math.max(0, emission - allocatedQuota - eligibleBankedUnits);
        const eligibleOffsetApplied = roundLot(Math.min(deficitBeforeOffset * 0.35, emission * sector.offset));
        const acknowledgedPurchases = 0;
        const acknowledgedSales = 0;
        const grossPosition = allocatedQuota - emission;
        const netPosition = allocatedQuota + acknowledgedPurchases - acknowledgedSales + eligibleBankedUnits + eligibleOffsetApplied - emission;
        const positionStatus = netPosition > 0 ? 'SURPLUS' : netPosition < 0 ? 'DEFICIT' : 'BALANCED';
        const eligibleHolding = allocatedQuota + eligibleBankedUnits + eligibleOffsetApplied;
        const maxSellQuantity = Math.min(eligibleHolding, Math.max(0, netPosition));
        const buyNeedRemaining = Math.max(0, -netPosition);
        const sourceStatus = year === 2026 ? 'PROVISIONAL' : 'VERIFIED';
        const sourceReference = `SYNTHETIC-V1-${year}-${participantId}`;
        const buyingCapacity = Math.max(scale.buyingCapacity, roundLot(buyNeedRemaining * 100_000 * 1.25));

        sourceRows.push({
          participant_id: participantId,
          legal_name: participantName,
          business_type: sector.name,
          scale_class: scale.name,
          operating_profile: variant.label,
          series_code: 'PTBAE-IND',
          compliance_period: year,
          pre_adjustment_quota: preAdjustmentQuota,
          quota_adjustment: quotaAdjustment,
          allocated_quota: allocatedQuota,
          verified_emission: emission,
          acknowledged_purchases: acknowledgedPurchases,
          acknowledged_sales: acknowledgedSales,
          eligible_banked_units: eligibleBankedUnits,
          eligible_offset_applied: eligibleOffsetApplied,
          eligible_holding: eligibleHolding,
          buying_capacity: buyingCapacity,
          source_status: sourceStatus,
          data_origin: 'SYNTHETIC',
          source_reference: sourceReference,
        });
        expectedRows.push({
          participant_id: participantId,
          compliance_period: year,
          gross_position: grossPosition,
          net_position: netPosition,
          position_status: positionStatus,
          max_sell_quantity: maxSellQuantity,
          buy_need_remaining: buyNeedRemaining,
        });
        priorNet = netPosition;
      }
    }
  }
}

const participantHeaders = ['participant_id', 'legal_name', 'business_type', 'scale_class', 'operating_profile', 'data_origin', 'status'];
const sourceHeaders = ['participant_id', 'legal_name', 'business_type', 'scale_class', 'operating_profile', 'series_code', 'compliance_period', 'pre_adjustment_quota', 'quota_adjustment', 'allocated_quota', 'verified_emission', 'acknowledged_purchases', 'acknowledged_sales', 'eligible_banked_units', 'eligible_offset_applied', 'eligible_holding', 'buying_capacity', 'source_status', 'data_origin', 'source_reference'];
const expectedHeaders = ['participant_id', 'compliance_period', 'gross_position', 'net_position', 'position_status', 'max_sell_quantity', 'buy_need_remaining'];
const negativeHeaders = ['case_id', 'validation_target', 'participant_id', 'compliance_period', 'field', 'invalid_value', 'expected_error'];
const negativeRows = [
  { case_id: 'NEG-001', validation_target: 'DUPLICATE_KEY', participant_id: 'SYN-COAL-S-A', compliance_period: 2024, field: 'participant_id+compliance_period', invalid_value: 'duplicate', expected_error: 'Duplicate participant/series/period must be rejected' },
  { case_id: 'NEG-002', validation_target: 'NON_NEGATIVE_QUOTA', participant_id: 'SYN-GAS-M-A', compliance_period: 2025, field: 'allocated_quota', invalid_value: -1000, expected_error: 'allocated_quota must be non-negative' },
  { case_id: 'NEG-003', validation_target: 'KNOWN_PARTICIPANT', participant_id: 'SYN-UNKNOWN-01', compliance_period: 2025, field: 'participant_id', invalid_value: 'SYN-UNKNOWN-01', expected_error: 'Participant must exist' },
  { case_id: 'NEG-004', validation_target: 'SOURCE_STATUS', participant_id: 'SYN-CEM-L-B', compliance_period: 2026, field: 'source_status', invalid_value: 'FINAL', expected_error: 'source_status must be VERIFIED or PROVISIONAL' },
  { case_id: 'NEG-005', validation_target: 'BANKING_LIMIT', participant_id: 'SYN-PLP-S-A', compliance_period: 2025, field: 'eligible_banked_units', invalid_value: 999999999, expected_error: 'Banked units cannot exceed eligible prior-period surplus' },
  { case_id: 'NEG-006', validation_target: 'SOURCE_REFERENCE', participant_id: 'SYN-MFG-M-B', compliance_period: 2024, field: 'source_reference', invalid_value: '', expected_error: 'Synthetic source reference is required' },
];

const participantCsv = toCsv(participantHeaders, participants);
const sourceCsv = toCsv(sourceHeaders, sourceRows);
const expectedCsv = toCsv(expectedHeaders, expectedRows);
const negativeCsv = toCsv(negativeHeaders, negativeRows);
const datasetHash = createHash('sha256').update(sourceCsv).digest('hex');

await Promise.all([
  fs.writeFile(path.join(outputDir, 'participants_2024_2026.csv'), participantCsv),
  fs.writeFile(path.join(outputDir, 'compliance_positions_2024_2026.csv'), sourceCsv),
  fs.writeFile(path.join(outputDir, 'expected_positions_2024_2026.csv'), expectedCsv),
  fs.writeFile(path.join(outputDir, 'negative_cases_2024_2026.csv'), negativeCsv),
]);

const sql = [];
sql.push('BEGIN;');
sql.push("INSERT INTO product_series (series_code, unit, status) VALUES ('PTBAE-IND', 'tCO2e', 'ACTIVE') ON CONFLICT (series_code) DO NOTHING;");
sql.push("INSERT INTO compliance_periods (series_code, year, status, starts_at, ends_at) VALUES\n  ('PTBAE-IND', 2024, 'CLOSED', '2024-01-01', '2024-12-31'),\n  ('PTBAE-IND', 2025, 'CLOSED', '2025-01-01', '2025-12-31'),\n  ('PTBAE-IND', 2026, 'DRAFT', '2026-01-01', '2026-12-31')\nON CONFLICT (series_code, year) DO UPDATE SET starts_at=EXCLUDED.starts_at, ends_at=EXCLUDED.ends_at;");
sql.push(`INSERT INTO compliance_import_batches (import_batch_id,dataset_code,dataset_sha256,data_origin,seed_version,covered_years,participant_count,position_row_count,imported_by,notes) VALUES ('24262024-0914-4a00-8000-000000000001','SYNTHETIC-PTBAE-IND-2024-2026-V1','${datasetHash}','SYNTHETIC',1,ARRAY[2024,2025,2026],${participants.length},${sourceRows.length},'DATASET_GENERATOR','Deterministic UAT data; not official quota or emission data') ON CONFLICT (dataset_code) DO UPDATE SET dataset_sha256=EXCLUDED.dataset_sha256,participant_count=EXCLUDED.participant_count,position_row_count=EXCLUDED.position_row_count,notes=EXCLUDED.notes;`);
sql.push(`INSERT INTO participants (participant_id,legal_name,status,business_type,scale_class,data_origin) VALUES\n${participants.map((row) => `  (${sqlText(row.participant_id)},${sqlText(row.legal_name)},'ACTIVE',${sqlText(row.business_type)},${sqlText(row.scale_class)},'SYNTHETIC')`).join(',\n')}\nON CONFLICT (participant_id) DO UPDATE SET legal_name=EXCLUDED.legal_name,business_type=EXCLUDED.business_type,scale_class=EXCLUDED.scale_class,data_origin='SYNTHETIC';`);
sql.push(`INSERT INTO annual_compliance_positions (participant_id,series_code,compliance_period,allocated_quota,verified_emission,acknowledged_purchases,acknowledged_sales,eligible_banked_units,eligible_offset_applied,source_status,source_reference,data_origin,import_batch_id) VALUES\n${sourceRows.map((row) => `  (${sqlText(row.participant_id)},'PTBAE-IND',${row.compliance_period},${row.allocated_quota},${row.verified_emission},0,0,${row.eligible_banked_units},${row.eligible_offset_applied},${sqlText(row.source_status)},${sqlText(row.source_reference)},'SYNTHETIC','24262024-0914-4a00-8000-000000000001')`).join(',\n')}\nON CONFLICT (participant_id,series_code,compliance_period) DO UPDATE SET allocated_quota=EXCLUDED.allocated_quota,verified_emission=EXCLUDED.verified_emission,eligible_banked_units=EXCLUDED.eligible_banked_units,eligible_offset_applied=EXCLUDED.eligible_offset_applied,source_status=EXCLUDED.source_status,source_reference=EXCLUDED.source_reference,data_origin='SYNTHETIC',import_batch_id=EXCLUDED.import_batch_id,version=annual_compliance_positions.version+1,updated_at=now()\nWHERE (annual_compliance_positions.allocated_quota,annual_compliance_positions.verified_emission,annual_compliance_positions.eligible_banked_units,annual_compliance_positions.eligible_offset_applied,annual_compliance_positions.source_status,annual_compliance_positions.source_reference,annual_compliance_positions.data_origin,annual_compliance_positions.import_batch_id) IS DISTINCT FROM (EXCLUDED.allocated_quota,EXCLUDED.verified_emission,EXCLUDED.eligible_banked_units,EXCLUDED.eligible_offset_applied,EXCLUDED.source_status,EXCLUDED.source_reference,EXCLUDED.data_origin,EXCLUDED.import_batch_id);`);
sql.push(`INSERT INTO balance_accounts (participant_id,series_code,compliance_period,eligible_holding,buying_capacity) VALUES\n${sourceRows.map((row) => `  (${sqlText(row.participant_id)},'PTBAE-IND',${row.compliance_period},${row.eligible_holding},${row.buying_capacity})`).join(',\n')}\nON CONFLICT (participant_id,series_code,compliance_period) DO NOTHING;`);
sql.push('COMMIT;');
sql.push('');
await fs.writeFile(path.join(rootDir, 'database', 'seeds', '003_synthetic_compliance_2024_2026.sql'), sql.join('\n'));

const summary = years.map((year) => {
  const rows = sourceRows.filter((row) => row.compliance_period === year);
  const expected = expectedRows.filter((row) => row.compliance_period === year);
  return {
    year,
    participants: rows.length,
    allocatedQuota: rows.reduce((sum, row) => sum + row.allocated_quota, 0),
    verifiedEmission: rows.reduce((sum, row) => sum + row.verified_emission, 0),
    bankedUnits: rows.reduce((sum, row) => sum + row.eligible_banked_units, 0),
    offsets: rows.reduce((sum, row) => sum + row.eligible_offset_applied, 0),
    netPosition: expected.reduce((sum, row) => sum + row.net_position, 0),
    surplusParticipants: expected.filter((row) => row.position_status === 'SURPLUS').length,
    deficitParticipants: expected.filter((row) => row.position_status === 'DEFICIT').length,
    balancedParticipants: expected.filter((row) => row.position_status === 'BALANCED').length,
  };
});
await fs.writeFile(path.join(outputDir, 'dataset-summary.json'), `${JSON.stringify({ datasetCode: 'SYNTHETIC-PTBAE-IND-2024-2026-V1', datasetHash, participantCount: participants.length, positionRowCount: sourceRows.length, summary }, null, 2)}\n`);

console.log(JSON.stringify({ datasetHash, participantCount: participants.length, positionRowCount: sourceRows.length, summary }, null, 2));
