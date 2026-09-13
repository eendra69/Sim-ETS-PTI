INSERT INTO product_series (series_code, unit, status)
VALUES ('PTBAE-IND', 'tCO2e', 'ACTIVE')
ON CONFLICT (series_code) DO NOTHING;

INSERT INTO compliance_periods (series_code, year, status)
VALUES ('PTBAE-IND', 2027, 'OPEN')
ON CONFLICT (series_code, year) DO NOTHING;

INSERT INTO participants (participant_id, legal_name, status)
VALUES
  ('IND-A', 'Industri A', 'ACTIVE'),
  ('IND-B', 'Industri B', 'ACTIVE'),
  ('IND-C', 'Industri C', 'ACTIVE'),
  ('IND-D', 'Industri D', 'ACTIVE')
ON CONFLICT (participant_id) DO NOTHING;

INSERT INTO annual_compliance_positions (
  participant_id,
  series_code,
  compliance_period,
  allocated_quota,
  verified_emission,
  source_status,
  source_reference
)
VALUES
  ('IND-A', 'PTBAE-IND', 2027, 1200000, 1170000, 'VERIFIED', 'DEMO-2027-A'),
  ('IND-B', 'PTBAE-IND', 2027, 2100000, 2050000, 'VERIFIED', 'DEMO-2027-B'),
  ('IND-C', 'PTBAE-IND', 2027, 900000, 860000, 'VERIFIED', 'DEMO-2027-C'),
  ('IND-D', 'PTBAE-IND', 2027, 1500000, 1560000, 'VERIFIED', 'DEMO-2027-D')
ON CONFLICT (participant_id, series_code, compliance_period) DO NOTHING;

INSERT INTO balance_accounts (
  participant_id,
  series_code,
  compliance_period,
  eligible_holding,
  buying_capacity
)
VALUES
  ('IND-A', 'PTBAE-IND', 2027, 1200000, 10000000000),
  ('IND-B', 'PTBAE-IND', 2027, 2100000, 10000000000),
  ('IND-C', 'PTBAE-IND', 2027, 900000, 10000000000),
  ('IND-D', 'PTBAE-IND', 2027, 1500000, 10000000000)
ON CONFLICT (participant_id, series_code, compliance_period) DO NOTHING;
