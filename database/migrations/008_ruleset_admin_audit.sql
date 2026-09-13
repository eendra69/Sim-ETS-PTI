CREATE TABLE IF NOT EXISTS market_rulesets (
  ruleset_id text PRIMARY KEY,
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('DRAFT', 'APPROVED', 'ACTIVE', 'RETIRED')),
  effective_from timestamptz,
  effective_to timestamptz,
  reference_price bigint NOT NULL CHECK (reference_price > 0),
  minimum_price bigint NOT NULL CHECK (minimum_price > 0),
  maximum_price bigint NOT NULL CHECK (maximum_price >= minimum_price),
  tick_size bigint NOT NULL CHECK (tick_size > 0),
  lot_size bigint NOT NULL CHECK (lot_size > 0),
  currency text NOT NULL DEFAULT 'IDR' CHECK (currency = 'IDR'),
  allowed_limit_tif text[] NOT NULL DEFAULT ARRAY['DAY','GTC'],
  market_time_in_force text NOT NULL DEFAULT 'IOC' CHECK (market_time_in_force = 'IOC'),
  market_protection_required boolean NOT NULL DEFAULT true,
  stop_trigger_basis text NOT NULL DEFAULT 'LTP' CHECK (stop_trigger_basis = 'LTP'),
  stop_buy_direction text NOT NULL DEFAULT 'GREATER_THAN_OR_EQUAL',
  stop_sell_direction text NOT NULL DEFAULT 'LESS_THAN_OR_EQUAL',
  stop_activation_type text NOT NULL DEFAULT 'MARKET',
  stop_reservation_timing text NOT NULL DEFAULT 'SUBMISSION',
  market_session_id text NOT NULL,
  sell_cap_percentage integer NOT NULL DEFAULT 100 CHECK (sell_cap_percentage BETWEEN 1 AND 100),
  settlement_finality text NOT NULL DEFAULT 'SRUK_ACK_RECONCILED'
    CHECK (settlement_finality IN ('DVP_SETTLED', 'SRUK_ACK_RECONCILED')),
  surveillance_price_deviation_bps integer NOT NULL DEFAULT 2000 CHECK (surveillance_price_deviation_bps > 0),
  surveillance_volume_threshold bigint NOT NULL DEFAULT 25000 CHECK (surveillance_volume_threshold > 0),
  repeated_cancel_threshold integer NOT NULL DEFAULT 3 CHECK (repeated_cancel_threshold > 0),
  created_by text NOT NULL,
  approved_by text,
  activated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series_code, compliance_period, version),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_ruleset
  ON market_rulesets (series_code, compliance_period)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS market_sessions (
  session_id text PRIMARY KEY,
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  ruleset_id text NOT NULL REFERENCES market_rulesets(ruleset_id),
  status text NOT NULL CHECK (status IN ('OPEN', 'HALTED', 'CLOSED')),
  opened_at timestamptz,
  halted_at timestamptz,
  resumed_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_sequence bigserial NOT NULL UNIQUE,
  event_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  actor_id text NOT NULL,
  permission_context text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  correlation_id uuid NOT NULL,
  causation_id text,
  ruleset_id text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_correlation
  ON audit_events (correlation_id, event_sequence);
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON audit_events (entity_type, entity_id, event_sequence);

CREATE OR REPLACE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TABLE IF NOT EXISTS governance_commands (
  command_scope text NOT NULL,
  idempotency_key text NOT NULL,
  aggregate_id text NOT NULL,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (command_scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS surveillance_alerts (
  alert_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_sequence bigserial NOT NULL UNIQUE,
  alert_type text NOT NULL CHECK (
    alert_type IN ('SELF_MATCH', 'UNUSUAL_PRICE', 'UNUSUAL_VOLUME', 'REPEATED_CANCEL', 'TRIGGER_ANOMALY')
  ),
  severity text NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  participant_id text,
  order_id uuid,
  trade_id uuid,
  trigger_event_id uuid,
  description text NOT NULL,
  evidence jsonb NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACKNOWLEDGED', 'CLOSED')),
  correlation_id uuid NOT NULL,
  ruleset_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surveillance_status
  ON surveillance_alerts (status, alert_sequence);

CREATE TABLE IF NOT EXISTS scenarios (
  scenario_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  series_code text NOT NULL,
  compliance_period integer NOT NULL,
  ruleset_id text NOT NULL,
  seed jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scenario_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id uuid NOT NULL REFERENCES scenarios(scenario_id),
  run_number integer NOT NULL CHECK (run_number > 0),
  result jsonb NOT NULL,
  result_hash text NOT NULL,
  replay_of_run_id uuid REFERENCES scenario_runs(run_id),
  is_deterministic_match boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scenario_id, run_number)
);

ALTER TABLE limit_orders ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE limit_orders ADD COLUMN IF NOT EXISTS causation_id text;
UPDATE limit_orders SET correlation_id = gen_random_uuid() WHERE correlation_id IS NULL;
ALTER TABLE limit_orders ALTER COLUMN correlation_id SET DEFAULT gen_random_uuid();
ALTER TABLE limit_orders ALTER COLUMN correlation_id SET NOT NULL;

ALTER TABLE stop_orders ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE stop_orders ADD COLUMN IF NOT EXISTS causation_id text;
UPDATE stop_orders SET correlation_id = gen_random_uuid() WHERE correlation_id IS NULL;
ALTER TABLE stop_orders ALTER COLUMN correlation_id SET DEFAULT gen_random_uuid();
ALTER TABLE stop_orders ALTER COLUMN correlation_id SET NOT NULL;

ALTER TABLE trades ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE trades ADD COLUMN IF NOT EXISTS causation_id text;
UPDATE trades t
SET correlation_id = me.correlation_id,
    causation_id = me.incoming_order_id::text
FROM match_events me
WHERE t.match_event_id = me.match_event_id AND t.correlation_id IS NULL;
ALTER TABLE trades ALTER COLUMN correlation_id SET DEFAULT gen_random_uuid();
ALTER TABLE trades ALTER COLUMN correlation_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM product_series WHERE series_code = 'PTBAE-IND') THEN
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
  END IF;
END $$;
