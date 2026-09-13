CREATE TABLE IF NOT EXISTS limit_orders (
  order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  client_order_id text NOT NULL,
  series_code text NOT NULL REFERENCES product_series(series_code),
  compliance_period integer NOT NULL CHECK (compliance_period >= 2000),
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  order_type text NOT NULL DEFAULT 'LIMIT' CHECK (order_type = 'LIMIT'),
  ruleset_id text NOT NULL DEFAULT 'PTBAE-IND-2027-PROTOTYPE-V1',
  quantity bigint NOT NULL CHECK (quantity > 0),
  remaining_quantity bigint NOT NULL CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity),
  limit_price bigint NOT NULL CHECK (limit_price > 0),
  time_in_force text NOT NULL CHECK (time_in_force IN ('DAY', 'GTC')),
  status text NOT NULL CHECK (status IN ('OPEN', 'CANCELLED', 'EXPIRED')),
  reservation_id uuid NOT NULL REFERENCES balance_reservations(reservation_id),
  priority_sequence bigserial NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  UNIQUE (participant_id, client_order_id)
);

ALTER TABLE limit_orders
  ADD COLUMN IF NOT EXISTS ruleset_id text;

UPDATE limit_orders
SET ruleset_id = 'PTBAE-IND-2027-PROTOTYPE-V1'
WHERE ruleset_id IS NULL;

ALTER TABLE limit_orders
  ALTER COLUMN ruleset_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_limit_order_book
  ON limit_orders (
    series_code,
    compliance_period,
    side,
    limit_price,
    priority_sequence
  )
  WHERE status = 'OPEN';
