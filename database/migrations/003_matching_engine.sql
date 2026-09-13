ALTER TABLE balance_accounts
  ADD COLUMN IF NOT EXISTS executed_buy_pending_funds bigint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'balance_accounts_executed_buy_pending_funds_check'
  ) THEN
    ALTER TABLE balance_accounts
      ADD CONSTRAINT balance_accounts_executed_buy_pending_funds_check
      CHECK (executed_buy_pending_funds >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'balance_accounts_total_buy_commitment_check'
  ) THEN
    ALTER TABLE balance_accounts
      ADD CONSTRAINT balance_accounts_total_buy_commitment_check
      CHECK (reserved_buy_funds + executed_buy_pending_funds <= buying_capacity);
  END IF;
END $$;

ALTER TABLE balance_reservations
  ADD COLUMN IF NOT EXISTS remaining_quantity bigint,
  ADD COLUMN IF NOT EXISTS remaining_amount bigint,
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

UPDATE balance_reservations
SET remaining_quantity = CASE WHEN status = 'ACTIVE' THEN quantity ELSE 0 END,
    remaining_amount = CASE WHEN status = 'ACTIVE' THEN amount ELSE 0 END
WHERE remaining_quantity IS NULL OR remaining_amount IS NULL;

ALTER TABLE balance_reservations
  ALTER COLUMN remaining_quantity SET NOT NULL,
  ALTER COLUMN remaining_amount SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'balance_reservations_remaining_check'
  ) THEN
    ALTER TABLE balance_reservations
      ADD CONSTRAINT balance_reservations_remaining_check
      CHECK (
        remaining_quantity >= 0 AND remaining_quantity <= quantity
        AND remaining_amount >= 0 AND remaining_amount <= amount
      );
  END IF;
END $$;

ALTER TABLE limit_orders DROP CONSTRAINT IF EXISTS limit_orders_status_check;
ALTER TABLE limit_orders
  ADD CONSTRAINT limit_orders_status_check
  CHECK (status IN ('OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'));

CREATE TABLE IF NOT EXISTS match_events (
  match_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incoming_order_id uuid NOT NULL REFERENCES limit_orders(order_id),
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  ruleset_id text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trades (
  trade_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_event_id uuid NOT NULL REFERENCES match_events(match_event_id),
  buyer_order_id uuid NOT NULL REFERENCES limit_orders(order_id),
  seller_order_id uuid NOT NULL REFERENCES limit_orders(order_id),
  buyer_participant_id text NOT NULL REFERENCES participants(participant_id),
  seller_participant_id text NOT NULL REFERENCES participants(participant_id),
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  quantity bigint NOT NULL CHECK (quantity > 0),
  price bigint NOT NULL CHECK (price > 0),
  notional bigint NOT NULL CHECK (notional > 0),
  ruleset_id text NOT NULL,
  status text NOT NULL DEFAULT 'EXECUTED' CHECK (status = 'EXECUTED'),
  trade_sequence bigserial NOT NULL UNIQUE,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_market_sequence
  ON trades (series_code, compliance_period, trade_sequence);

CREATE INDEX IF NOT EXISTS idx_trades_orders
  ON trades (buyer_order_id, seller_order_id);
