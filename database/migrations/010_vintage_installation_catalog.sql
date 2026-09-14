CREATE TABLE IF NOT EXISTS quota_vintages (
  vintage_id text PRIMARY KEY,
  series_code text NOT NULL REFERENCES product_series(series_code),
  vintage_year integer NOT NULL CHECK (vintage_year >= 2000),
  display_label text NOT NULL,
  effective_from timestamptz NOT NULL,
  expires_at timestamptz,
  banking_status text NOT NULL CHECK (
    banking_status IN ('CURRENT_YEAR', 'BANKED_AVAILABLE', 'RESTRICTED', 'EXPIRED', 'PLAN_SEED')
  ),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'PLANNED')),
  policy_source text NOT NULL,
  policy_certainty text NOT NULL CHECK (
    policy_certainty IN ('OFFICIAL', 'FIXED_PROJECT', 'SIMULATION_ASSUMPTION')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_code, vintage_year)
);

CREATE TABLE IF NOT EXISTS product_admissions (
  product_admission_id text PRIMARY KEY,
  series_code text NOT NULL,
  vintage_year integer NOT NULL,
  market_segment text NOT NULL CHECK (market_segment = 'REGULAR'),
  fungibility_key text NOT NULL UNIQUE,
  cross_vintage_matching boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'PLANNED')),
  effective_from timestamptz NOT NULL,
  expires_at timestamptz,
  policy_source text NOT NULL,
  policy_certainty text NOT NULL CHECK (
    policy_certainty IN ('OFFICIAL', 'FIXED_PROJECT', 'SIMULATION_ASSUMPTION')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_code, vintage_year, market_segment),
  UNIQUE (product_admission_id, series_code, vintage_year),
  FOREIGN KEY (series_code, vintage_year)
    REFERENCES quota_vintages(series_code, vintage_year)
);

CREATE TABLE IF NOT EXISTS vintage_eligibility_rules (
  eligibility_rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_admission_id text NOT NULL,
  series_code text NOT NULL,
  vintage_year integer NOT NULL,
  target_compliance_period integer NOT NULL CHECK (target_compliance_period >= 2000),
  eligible boolean NOT NULL,
  usage_priority integer NOT NULL CHECK (usage_priority > 0),
  reason text NOT NULL,
  policy_source text NOT NULL,
  policy_certainty text NOT NULL CHECK (
    policy_certainty IN ('OFFICIAL', 'FIXED_PROJECT', 'SIMULATION_ASSUMPTION')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_admission_id, target_compliance_period),
  FOREIGN KEY (product_admission_id, series_code, vintage_year)
    REFERENCES product_admissions(product_admission_id, series_code, vintage_year),
  FOREIGN KEY (series_code, target_compliance_period)
    REFERENCES compliance_periods(series_code, year)
);

CREATE TABLE IF NOT EXISTS installations (
  installation_id text PRIMARY KEY,
  participant_id text NOT NULL REFERENCES participants(participant_id),
  installation_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  data_origin text NOT NULL DEFAULT 'UNSPECIFIED'
    CHECK (data_origin IN ('UNSPECIFIED', 'OFFICIAL', 'SYNTHETIC')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, participant_id)
);

CREATE TABLE IF NOT EXISTS trader_accounts (
  trader_account_id text PRIMARY KEY,
  participant_id text NOT NULL REFERENCES participants(participant_id),
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trader_account_id, participant_id)
);

CREATE TABLE IF NOT EXISTS trader_installation_scopes (
  trader_account_id text NOT NULL,
  installation_id text NOT NULL,
  participant_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trader_account_id, installation_id),
  FOREIGN KEY (trader_account_id, participant_id)
    REFERENCES trader_accounts(trader_account_id, participant_id),
  FOREIGN KEY (installation_id, participant_id)
    REFERENCES installations(installation_id, participant_id)
);

CREATE TABLE IF NOT EXISTS vintage_holdings (
  vintage_holding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL,
  installation_id text NOT NULL,
  series_code text NOT NULL,
  vintage_year integer NOT NULL CHECK (vintage_year >= 2000),
  total_units bigint NOT NULL CHECK (total_units >= 0),
  locked_units bigint NOT NULL DEFAULT 0 CHECK (locked_units >= 0),
  surrendered_units bigint NOT NULL DEFAULT 0 CHECK (surrendered_units >= 0),
  reserved_sell bigint NOT NULL DEFAULT 0 CHECK (reserved_sell >= 0),
  executed_sell_pending bigint NOT NULL DEFAULT 0 CHECK (executed_sell_pending >= 0),
  source_status text NOT NULL CHECK (source_status IN ('PROJECTED', 'PROVISIONAL', 'VERIFIED')),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'LOCKED', 'EXHAUSTED')),
  data_origin text NOT NULL CHECK (data_origin IN ('UNSPECIFIED', 'OFFICIAL', 'SYNTHETIC')),
  provenance_type text NOT NULL CHECK (
    provenance_type IN ('ALLOCATION', 'TRADE_RECEIPT', 'MIGRATED_AGGREGATE', 'SYNTHETIC_DERIVED')
  ),
  source_reference text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, series_code, vintage_year),
  CHECK (locked_units + surrendered_units + reserved_sell + executed_sell_pending <= total_units),
  FOREIGN KEY (installation_id, participant_id)
    REFERENCES installations(installation_id, participant_id),
  FOREIGN KEY (series_code, vintage_year)
    REFERENCES quota_vintages(series_code, vintage_year)
);

CREATE INDEX IF NOT EXISTS idx_quota_vintage_status
  ON quota_vintages (series_code, status, vintage_year);

CREATE INDEX IF NOT EXISTS idx_vintage_eligibility_target
  ON vintage_eligibility_rules (series_code, target_compliance_period, eligible, usage_priority);

CREATE INDEX IF NOT EXISTS idx_installations_participant
  ON installations (participant_id, status, installation_id);

CREATE INDEX IF NOT EXISTS idx_vintage_holdings_owner
  ON vintage_holdings (participant_id, installation_id, series_code, vintage_year);

