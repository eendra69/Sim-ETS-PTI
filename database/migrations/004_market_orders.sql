ALTER TABLE limit_orders
  ADD COLUMN IF NOT EXISTS protection_price bigint;

ALTER TABLE limit_orders
  ALTER COLUMN limit_price DROP NOT NULL;

ALTER TABLE limit_orders DROP CONSTRAINT IF EXISTS limit_orders_order_type_check;
ALTER TABLE limit_orders DROP CONSTRAINT IF EXISTS limit_orders_time_in_force_check;
ALTER TABLE limit_orders DROP CONSTRAINT IF EXISTS limit_orders_status_check;
ALTER TABLE limit_orders DROP CONSTRAINT IF EXISTS limit_orders_field_rules_check;
ALTER TABLE limit_orders DROP CONSTRAINT IF EXISTS limit_orders_protection_price_check;

ALTER TABLE limit_orders
  ADD CONSTRAINT limit_orders_order_type_check
    CHECK (order_type IN ('LIMIT', 'MARKET')),
  ADD CONSTRAINT limit_orders_time_in_force_check
    CHECK (time_in_force IN ('DAY', 'GTC', 'IOC')),
  ADD CONSTRAINT limit_orders_status_check
    CHECK (
      status IN (
        'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'CANCELLED_REMAINDER'
      )
    ),
  ADD CONSTRAINT limit_orders_protection_price_check
    CHECK (protection_price IS NULL OR protection_price > 0),
  ADD CONSTRAINT limit_orders_field_rules_check
    CHECK (
      (
        order_type = 'LIMIT'
        AND limit_price IS NOT NULL
        AND protection_price IS NULL
        AND time_in_force IN ('DAY', 'GTC')
      )
      OR
      (
        order_type = 'MARKET'
        AND limit_price IS NULL
        AND protection_price IS NOT NULL
        AND time_in_force = 'IOC'
      )
    );

CREATE INDEX IF NOT EXISTS idx_market_order_status
  ON limit_orders (series_code, compliance_period, order_type, status, priority_sequence);
