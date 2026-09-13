CREATE TABLE IF NOT EXISTS trade_legs (
  trade_leg_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  order_id uuid NOT NULL REFERENCES limit_orders(order_id),
  side text NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity bigint NOT NULL CHECK (quantity > 0),
  notional bigint NOT NULL CHECK (notional > 0),
  unit_delta bigint NOT NULL,
  cash_delta bigint NOT NULL,
  status text NOT NULL DEFAULT 'EXECUTED' CHECK (status = 'EXECUTED'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_id, side),
  CHECK (
    (side = 'BUY' AND unit_delta = quantity AND cash_delta = -notional)
    OR
    (side = 'SELL' AND unit_delta = -quantity AND cash_delta = notional)
  )
);

INSERT INTO trade_legs (
  trade_id, participant_id, order_id, side, quantity, notional, unit_delta, cash_delta,
  status, created_at
)
SELECT
  trade_id, buyer_participant_id, buyer_order_id, 'BUY', quantity, notional, quantity,
  -notional, 'EXECUTED', executed_at
FROM trades
ON CONFLICT (trade_id, side) DO NOTHING;

INSERT INTO trade_legs (
  trade_id, participant_id, order_id, side, quantity, notional, unit_delta, cash_delta,
  status, created_at
)
SELECT
  trade_id, seller_participant_id, seller_order_id, 'SELL', quantity, notional, -quantity,
  notional, 'EXECUTED', executed_at
FROM trades
ON CONFLICT (trade_id, side) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_trade_legs_participant
  ON trade_legs (participant_id, created_at, trade_leg_id);
