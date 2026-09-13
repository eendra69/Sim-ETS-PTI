INSERT INTO market_rulesets (
  ruleset_id, series_code, compliance_period, version, status, effective_from,
  reference_price, minimum_price, maximum_price, tick_size, lot_size,
  market_session_id, sell_cap_percentage, settlement_finality,
  surveillance_price_deviation_bps, surveillance_volume_threshold,
  repeated_cancel_threshold, created_by, approved_by, activated_by,
  approved_at, activated_at
) VALUES (
  'PTBAE-IND-2027-PROTOTYPE-V1', 'PTBAE-IND', 2027, 1, 'ACTIVE', now(),
  75000, 60000, 90000, 200, 1,
  'PTBAE-IND-2027-REGULAR', 100, 'SRUK_ACK_RECONCILED',
  2000, 25000, 3, 'SYSTEM', 'SYSTEM', 'SYSTEM', now(), now()
) ON CONFLICT (ruleset_id) DO NOTHING;

INSERT INTO market_sessions (
  session_id, series_code, compliance_period, ruleset_id, status, opened_at
) VALUES (
  'PTBAE-IND-2027-REGULAR', 'PTBAE-IND', 2027,
  'PTBAE-IND-2027-PROTOTYPE-V1', 'OPEN', now()
) ON CONFLICT (session_id) DO NOTHING;
