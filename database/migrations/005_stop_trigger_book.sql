CREATE TABLE IF NOT EXISTS stop_orders (
  stop_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  client_order_id text NOT NULL,
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  ruleset_id text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  remaining_quantity bigint NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity),
  stop_price bigint NOT NULL CHECK (stop_price > 0),
  protection_price bigint NOT NULL CHECK (protection_price > 0),
  trigger_basis text NOT NULL CHECK (trigger_basis = 'LTP'),
  activation_type text NOT NULL CHECK (activation_type = 'MARKET'),
  time_in_force text NOT NULL CHECK (time_in_force IN ('DAY', 'GTC')),
  status text NOT NULL CHECK (
    status IN ('TRIGGER_PENDING', 'ACTIVATED', 'CANCELLED', 'EXPIRED', 'ACTIVATION_FAILED')
  ),
  reservation_id uuid NOT NULL REFERENCES balance_reservations(reservation_id),
  priority_sequence bigserial NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (participant_id, client_order_id)
);

ALTER TABLE limit_orders
  ADD COLUMN IF NOT EXISTS parent_stop_order_id uuid REFERENCES stop_orders(stop_order_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_limit_orders_parent_stop
  ON limit_orders (parent_stop_order_id)
  WHERE parent_stop_order_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS trigger_events (
  trigger_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_order_id uuid NOT NULL UNIQUE REFERENCES stop_orders(stop_order_id),
  source_trade_id uuid NOT NULL REFERENCES trades(trade_id),
  observed_ltp bigint NOT NULL CHECK (observed_ltp > 0),
  trigger_basis text NOT NULL CHECK (trigger_basis = 'LTP'),
  activated_order_id uuid NOT NULL UNIQUE REFERENCES limit_orders(order_id),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  triggered_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stop_trigger_book
  ON stop_orders (series_code, compliance_period, side, stop_price, priority_sequence)
  WHERE status = 'TRIGGER_PENDING';

CREATE INDEX IF NOT EXISTS idx_trigger_events_source_trade
  ON trigger_events (source_trade_id, triggered_at);
