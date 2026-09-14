INSERT INTO quota_vintages (
  vintage_id, series_code, vintage_year, display_label, effective_from, expires_at,
  banking_status, status, policy_source, policy_certainty
) VALUES
  ('VINT-PTBAE-IND-2024', 'PTBAE-IND', 2024, 'PTBAE-IND - Vintage 2024', '2024-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'BANKED_AVAILABLE', 'ACTIVE', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('VINT-PTBAE-IND-2025', 'PTBAE-IND', 2025, 'PTBAE-IND - Vintage 2025', '2025-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'BANKED_AVAILABLE', 'ACTIVE', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('VINT-PTBAE-IND-2026', 'PTBAE-IND', 2026, 'PTBAE-IND - Vintage 2026', '2026-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'CURRENT_YEAR', 'ACTIVE', 'CURRENT_2026_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('VINT-PTBAE-IND-2027', 'PTBAE-IND', 2027, 'PTBAE-IND - Vintage 2027', '2027-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'PLAN_SEED', 'ACTIVE', 'SOFTWARE_PLAN_V0.4_SEED', 'SIMULATION_ASSUMPTION')
ON CONFLICT (series_code, vintage_year) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  effective_from = EXCLUDED.effective_from,
  expires_at = EXCLUDED.expires_at,
  banking_status = EXCLUDED.banking_status,
  status = EXCLUDED.status,
  policy_source = EXCLUDED.policy_source,
  policy_certainty = EXCLUDED.policy_certainty,
  updated_at = now();

INSERT INTO product_admissions (
  product_admission_id, series_code, vintage_year, market_segment, fungibility_key,
  cross_vintage_matching, status, effective_from, expires_at, policy_source, policy_certainty
) VALUES
  ('ADM-PTBAE-IND-V2024-REG', 'PTBAE-IND', 2024, 'REGULAR', 'PTBAE-IND:V2024:REG', false, 'ACTIVE', '2024-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2025-REG', 'PTBAE-IND', 2025, 'REGULAR', 'PTBAE-IND:V2025:REG', false, 'ACTIVE', '2025-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2026-REG', 'PTBAE-IND', 2026, 'REGULAR', 'PTBAE-IND:V2026:REG', false, 'ACTIVE', '2026-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'CURRENT_2026_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2027-REG', 'PTBAE-IND', 2027, 'REGULAR', 'PTBAE-IND:V2027:REG', false, 'ACTIVE', '2027-01-01T00:00:00+07:00', '2027-12-31T23:59:59+07:00', 'SOFTWARE_PLAN_V0.4_SEED', 'SIMULATION_ASSUMPTION')
ON CONFLICT (product_admission_id) DO UPDATE SET
  fungibility_key = EXCLUDED.fungibility_key,
  cross_vintage_matching = EXCLUDED.cross_vintage_matching,
  status = EXCLUDED.status,
  effective_from = EXCLUDED.effective_from,
  expires_at = EXCLUDED.expires_at,
  policy_source = EXCLUDED.policy_source,
  policy_certainty = EXCLUDED.policy_certainty,
  updated_at = now();

INSERT INTO vintage_eligibility_rules (
  product_admission_id, series_code, vintage_year, target_compliance_period,
  eligible, usage_priority, reason, policy_source, policy_certainty
) VALUES
  ('ADM-PTBAE-IND-V2024-REG', 'PTBAE-IND', 2024, 2026, true, 3, 'Banked vintage accepted for CP-2026 in the simulator', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2024-REG', 'PTBAE-IND', 2024, 2027, true, 3, 'Banked vintage accepted for CP-2027 in the simulator', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2025-REG', 'PTBAE-IND', 2025, 2025, true, 1, 'Current-year vintage accepted for CP-2025 UAT simulation', 'SYNTHETIC_UAT_2025', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2025-REG', 'PTBAE-IND', 2025, 2027, true, 2, 'Banked vintage accepted for CP-2027 in the simulator', 'CARRYOVER_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2026-REG', 'PTBAE-IND', 2026, 2026, true, 1, 'Current-year vintage accepted for CP-2026 in the simulator', 'CURRENT_2026_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2026-REG', 'PTBAE-IND', 2026, 2027, true, 1, 'Vintage accepted for CP-2027 in the simulator', 'CURRENT_2026_SIMULATION', 'SIMULATION_ASSUMPTION'),
  ('ADM-PTBAE-IND-V2027-REG', 'PTBAE-IND', 2027, 2027, true, 1, 'Planned seed vintage accepted for CP-2027 simulation', 'SOFTWARE_PLAN_V0.4_SEED', 'SIMULATION_ASSUMPTION')
ON CONFLICT (product_admission_id, target_compliance_period) DO UPDATE SET
  eligible = EXCLUDED.eligible,
  usage_priority = EXCLUDED.usage_priority,
  reason = EXCLUDED.reason,
  policy_source = EXCLUDED.policy_source,
  policy_certainty = EXCLUDED.policy_certainty,
  updated_at = now();

INSERT INTO installations (
  installation_id, participant_id, installation_name, status, data_origin
)
SELECT
  CASE participant_id
    WHEN 'IND-A' THEN 'INST-A-01'
    WHEN 'IND-B' THEN 'INST-B-01'
    WHEN 'IND-C' THEN 'INST-C-01'
    WHEN 'IND-D' THEN 'INST-D-01'
    ELSE 'INST-' || participant_id || '-01'
  END,
  participant_id,
  legal_name || ' - Instalasi 01',
  CASE WHEN status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
  data_origin
FROM participants
ON CONFLICT (installation_id) DO UPDATE SET
  installation_name = EXCLUDED.installation_name,
  status = EXCLUDED.status,
  data_origin = EXCLUDED.data_origin,
  updated_at = now();

INSERT INTO trader_accounts (trader_account_id, participant_id, display_name, status)
SELECT
  CASE participant_id
    WHEN 'IND-A' THEN 'TA-A-001'
    WHEN 'IND-B' THEN 'TA-B-001'
    WHEN 'IND-C' THEN 'TA-C-001'
    WHEN 'IND-D' THEN 'TA-D-001'
    ELSE 'TA-' || participant_id || '-001'
  END,
  participant_id,
  legal_name || ' - Trader',
  CASE WHEN status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END
FROM participants
ON CONFLICT (trader_account_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  updated_at = now();

INSERT INTO trader_installation_scopes (
  trader_account_id, installation_id, participant_id, status
)
SELECT
  t.trader_account_id,
  i.installation_id,
  i.participant_id,
  CASE WHEN t.status = 'ACTIVE' AND i.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END
FROM trader_accounts t
JOIN installations i ON i.participant_id = t.participant_id
ON CONFLICT (trader_account_id, installation_id) DO UPDATE SET
  status = EXCLUDED.status;

-- Provenance rule: only same-year gross allocation surplus is materialized here.
-- eligible_banked_units is intentionally not assigned to a vintage because its origin year is unknown.
INSERT INTO vintage_holdings (
  participant_id, installation_id, series_code, vintage_year, total_units,
  source_status, status, data_origin, provenance_type, source_reference
)
SELECT
  p.participant_id,
  i.installation_id,
  p.series_code,
  p.compliance_period,
  GREATEST(p.allocated_quota - p.verified_emission - p.acknowledged_sales, 0),
  p.source_status,
  CASE
    WHEN GREATEST(p.allocated_quota - p.verified_emission - p.acknowledged_sales, 0) = 0 THEN 'EXHAUSTED'
    ELSE 'ACTIVE'
  END,
  p.data_origin,
  'SYNTHETIC_DERIVED',
  COALESCE(p.source_reference, 'ANNUAL-POSITION-' || p.position_id::text)
FROM annual_compliance_positions p
JOIN installations i ON i.participant_id = p.participant_id
JOIN quota_vintages q
  ON q.series_code = p.series_code AND q.vintage_year = p.compliance_period
WHERE p.data_origin = 'SYNTHETIC'
   OR p.participant_id IN ('IND-A', 'IND-B', 'IND-C', 'IND-D')
ON CONFLICT (installation_id, series_code, vintage_year) DO UPDATE SET
  total_units = EXCLUDED.total_units,
  source_status = EXCLUDED.source_status,
  status = EXCLUDED.status,
  data_origin = EXCLUDED.data_origin,
  provenance_type = EXCLUDED.provenance_type,
  source_reference = EXCLUDED.source_reference,
  version = vintage_holdings.version + 1,
  updated_at = now()
WHERE (
  vintage_holdings.total_units,
  vintage_holdings.source_status,
  vintage_holdings.status,
  vintage_holdings.data_origin,
  vintage_holdings.provenance_type,
  vintage_holdings.source_reference
) IS DISTINCT FROM (
  EXCLUDED.total_units,
  EXCLUDED.source_status,
  EXCLUDED.status,
  EXCLUDED.data_origin,
  EXCLUDED.provenance_type,
  EXCLUDED.source_reference
);
