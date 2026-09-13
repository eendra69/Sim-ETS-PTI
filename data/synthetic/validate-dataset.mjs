import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.dirname(fileURLToPath(import.meta.url));

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(',');
  return lines.map((line) => Object.fromEntries(line.split(',').map((value, index) => [headers[index], value])));
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

const sourceText = await fs.readFile(path.join(dataDir, 'compliance_positions_2024_2026.csv'), 'utf8');
const participants = parseCsv(await fs.readFile(path.join(dataDir, 'participants_2024_2026.csv'), 'utf8'));
const positions = parseCsv(sourceText);
const expected = parseCsv(await fs.readFile(path.join(dataDir, 'expected_positions_2024_2026.csv'), 'utf8'));
const summary = JSON.parse(await fs.readFile(path.join(dataDir, 'dataset-summary.json'), 'utf8'));
const participantIds = new Set(participants.map((row) => row.participant_id));
const positionKeys = new Set();
const expectedByKey = new Map(expected.map((row) => [`${row.participant_id}|${row.compliance_period}`, row]));

requireCondition(participants.length === 42, 'Expected 42 participants');
requireCondition(participantIds.size === 42, 'Participant IDs must be unique');
requireCondition(positions.length === 126, 'Expected 126 annual positions');
requireCondition(expected.length === 126, 'Expected 126 expected-result rows');
requireCondition(summary.datasetHash === createHash('sha256').update(sourceText).digest('hex'), 'Dataset hash mismatch');

for (const row of positions) {
  const key = `${row.participant_id}|${row.compliance_period}`;
  requireCondition(participantIds.has(row.participant_id), `Unknown participant at ${key}`);
  requireCondition(!positionKeys.has(key), `Duplicate annual position at ${key}`);
  positionKeys.add(key);
  requireCondition(row.data_origin === 'SYNTHETIC', `Non-synthetic origin at ${key}`);
  requireCondition(row.source_reference.startsWith('SYNTHETIC-V1-'), `Invalid source reference at ${key}`);
  requireCondition(Number(row.compliance_period) === 2026 ? row.source_status === 'PROVISIONAL' : row.source_status === 'VERIFIED', `Invalid source status at ${key}`);

  const numericFields = ['pre_adjustment_quota', 'quota_adjustment', 'allocated_quota', 'verified_emission', 'acknowledged_purchases', 'acknowledged_sales', 'eligible_banked_units', 'eligible_offset_applied', 'eligible_holding', 'buying_capacity'];
  const values = Object.fromEntries(numericFields.map((field) => [field, Number(row[field])]));
  for (const field of numericFields.filter((field) => field !== 'quota_adjustment')) {
    requireCondition(Number.isSafeInteger(values[field]) && values[field] >= 0, `${field} is invalid at ${key}`);
  }
  for (const field of numericFields.filter((field) => !['quota_adjustment', 'buying_capacity'].includes(field))) {
    requireCondition(values[field] % 1000 === 0, `${field} is not a 1,000 tCO2e lot at ${key}`);
  }
  requireCondition(values.pre_adjustment_quota + values.quota_adjustment === values.allocated_quota, `Quota adjustment mismatch at ${key}`);
  requireCondition(values.allocated_quota + values.eligible_banked_units + values.eligible_offset_applied === values.eligible_holding, `Eligible holding mismatch at ${key}`);

  const expectedRow = expectedByKey.get(key);
  requireCondition(Boolean(expectedRow), `Expected result is missing at ${key}`);
  const gross = values.allocated_quota - values.verified_emission;
  const net = values.allocated_quota + values.acknowledged_purchases - values.acknowledged_sales + values.eligible_banked_units + values.eligible_offset_applied - values.verified_emission;
  const status = net > 0 ? 'SURPLUS' : net < 0 ? 'DEFICIT' : 'BALANCED';
  requireCondition(Number(expectedRow.gross_position) === gross, `Gross position mismatch at ${key}`);
  requireCondition(Number(expectedRow.net_position) === net, `Net position mismatch at ${key}`);
  requireCondition(expectedRow.position_status === status, `Position status mismatch at ${key}`);
  requireCondition(Number(expectedRow.max_sell_quantity) === Math.min(values.eligible_holding, Math.max(0, net)), `Sell right mismatch at ${key}`);
  requireCondition(Number(expectedRow.buy_need_remaining) === Math.max(0, -net), `Buy need mismatch at ${key}`);

  if (Number(row.compliance_period) > 2024) {
    const prior = expectedByKey.get(`${row.participant_id}|${Number(row.compliance_period) - 1}`);
    requireCondition(values.eligible_banked_units <= Math.max(0, Number(prior.net_position)), `Banked units exceed prior surplus at ${key}`);
  }
}

console.log(JSON.stringify({ status: 'PASS', participants: participants.length, annualPositions: positions.length, datasetHash: summary.datasetHash }, null, 2));
