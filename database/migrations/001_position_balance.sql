CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS product_series (
  series_code text PRIMARY KEY,
  unit text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance_periods (
  period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_code text NOT NULL REFERENCES product_series(series_code),
  year integer NOT NULL CHECK (year >= 2000),
  status text NOT NULL CHECK (status IN ('DRAFT', 'OPEN', 'CLOSED')),
  starts_at date,
  ends_at date,
  UNIQUE (series_code, year)
);

CREATE TABLE IF NOT EXISTS participants (
  participant_id text PRIMARY KEY,
  legal_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS annual_compliance_positions (
  position_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  allocated_quota bigint NOT NULL CHECK (allocated_quota >= 0),
  verified_emission bigint NOT NULL CHECK (verified_emission >= 0),
  acknowledged_purchases bigint NOT NULL DEFAULT 0 CHECK (acknowledged_purchases >= 0),
  acknowledged_sales bigint NOT NULL DEFAULT 0 CHECK (acknowledged_sales >= 0),
  eligible_banked_units bigint NOT NULL DEFAULT 0 CHECK (eligible_banked_units >= 0),
  eligible_offset_applied bigint NOT NULL DEFAULT 0 CHECK (eligible_offset_applied >= 0),
  source_status text NOT NULL DEFAULT 'VERIFIED' CHECK (source_status IN ('PROJECTED', 'VERIFIED')),
  source_reference text,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, series_code, compliance_period)
);

CREATE TABLE IF NOT EXISTS balance_accounts (
  balance_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  eligible_holding bigint NOT NULL DEFAULT 0 CHECK (eligible_holding >= 0),
  locked_units bigint NOT NULL DEFAULT 0 CHECK (locked_units >= 0),
  surrendered_units bigint NOT NULL DEFAULT 0 CHECK (surrendered_units >= 0),
  reserved_sell bigint NOT NULL DEFAULT 0 CHECK (reserved_sell >= 0),
  executed_sell_pending bigint NOT NULL DEFAULT 0 CHECK (executed_sell_pending >= 0),
  buying_capacity bigint NOT NULL DEFAULT 0 CHECK (buying_capacity >= 0),
  reserved_buy_funds bigint NOT NULL DEFAULT 0 CHECK (reserved_buy_funds >= 0),
  reserved_buy_quantity bigint NOT NULL DEFAULT 0 CHECK (reserved_buy_quantity >= 0),
  executed_buy_pending bigint NOT NULL DEFAULT 0 CHECK (executed_buy_pending >= 0),
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, series_code, compliance_period),
  CHECK (locked_units + surrendered_units + reserved_sell + executed_sell_pending <= eligible_holding),
  CHECK (reserved_buy_funds <= buying_capacity)
);

CREATE TABLE IF NOT EXISTS balance_reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  order_reference text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('SELL_QUOTA', 'BUY_FUNDS')),
  quantity bigint NOT NULL CHECK (quantity > 0),
  amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  UNIQUE (participant_id, order_reference, kind)
);

CREATE INDEX IF NOT EXISTS idx_position_series_period
  ON annual_compliance_positions (series_code, compliance_period);

CREATE INDEX IF NOT EXISTS idx_active_reservation_participant
  ON balance_reservations (participant_id, series_code, compliance_period)
  WHERE status = 'ACTIVE';
