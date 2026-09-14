ALTER TABLE limit_orders
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS vintage_year integer;

-- Upgrade safety: migration execution precedes idempotent seeds during application bootstrap.
-- Materialize only missing catalogue parents needed to preserve existing order history.
INSERT INTO quota_vintages (
  vintage_id, series_code, vintage_year, display_label, effective_from,
  banking_status, status, policy_source, policy_certainty
)
SELECT
  'VINT-' || source.series_code || '-' || source.vintage_year,
  source.series_code,
  source.vintage_year,
  source.series_code || ' - Vintage ' || source.vintage_year,
  make_date(source.vintage_year, 1, 1)::timestamptz,
  'PLAN_SEED',
  'ACTIVE',
  'MIGRATION_011_BACKFILL',
  'FIXED_PROJECT'
FROM (
  SELECT DISTINCT series_code, compliance_period AS vintage_year FROM limit_orders
  UNION
  SELECT DISTINCT series_code, compliance_period AS vintage_year FROM stop_orders
) source
ON CONFLICT (series_code, vintage_year) DO NOTHING;

INSERT INTO installations (installation_id, participant_id, installation_name, status, data_origin)
SELECT
  CASE p.participant_id
    WHEN 'IND-A' THEN 'INST-A-01'
    WHEN 'IND-B' THEN 'INST-B-01'
    WHEN 'IND-C' THEN 'INST-C-01'
    WHEN 'IND-D' THEN 'INST-D-01'
    ELSE 'INST-' || p.participant_id || '-01'
  END,
  p.participant_id,
  p.legal_name || ' - Instalasi 01',
  CASE WHEN p.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
  p.data_origin
FROM participants p
WHERE EXISTS (SELECT 1 FROM limit_orders o WHERE o.participant_id = p.participant_id)
   OR EXISTS (SELECT 1 FROM stop_orders o WHERE o.participant_id = p.participant_id)
ON CONFLICT (installation_id) DO NOTHING;

UPDATE limit_orders o
SET installation_id = (
  SELECT installation_id FROM installations
  WHERE participant_id = o.participant_id
  ORDER BY installation_id LIMIT 1
)
WHERE o.installation_id IS NULL;

UPDATE limit_orders SET vintage_year = compliance_period WHERE vintage_year IS NULL;

ALTER TABLE stop_orders
  ADD COLUMN IF NOT EXISTS installation_id text,
  ADD COLUMN IF NOT EXISTS vintage_year integer;

UPDATE stop_orders o
SET installation_id = (
  SELECT installation_id FROM installations
  WHERE participant_id = o.participant_id
  ORDER BY installation_id LIMIT 1
)
WHERE o.installation_id IS NULL;

UPDATE stop_orders SET vintage_year = compliance_period WHERE vintage_year IS NULL;

ALTER TABLE match_events ADD COLUMN IF NOT EXISTS vintage_year integer;
UPDATE match_events m SET vintage_year = o.vintage_year
FROM limit_orders o WHERE o.order_id = m.incoming_order_id AND m.vintage_year IS NULL;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS buyer_installation_id text,
  ADD COLUMN IF NOT EXISTS seller_installation_id text,
  ADD COLUMN IF NOT EXISTS vintage_year integer;

UPDATE trades t
SET buyer_installation_id = buyer.installation_id,
    seller_installation_id = seller.installation_id,
    vintage_year = buyer.vintage_year
FROM limit_orders buyer, limit_orders seller
WHERE buyer.order_id = t.buyer_order_id
  AND seller.order_id = t.seller_order_id
  AND (t.buyer_installation_id IS NULL OR t.seller_installation_id IS NULL OR t.vintage_year IS NULL);

ALTER TABLE settlement_instructions
  ADD COLUMN IF NOT EXISTS buyer_installation_id text,
  ADD COLUMN IF NOT EXISTS seller_installation_id text,
  ADD COLUMN IF NOT EXISTS vintage_year integer;

UPDATE settlement_instructions s
SET buyer_installation_id = t.buyer_installation_id,
    seller_installation_id = t.seller_installation_id,
    vintage_year = t.vintage_year
FROM trades t
WHERE t.trade_id = s.trade_id
  AND (s.buyer_installation_id IS NULL OR s.seller_installation_id IS NULL OR s.vintage_year IS NULL);

ALTER TABLE limit_orders
  ALTER COLUMN installation_id SET NOT NULL,
  ALTER COLUMN vintage_year SET NOT NULL;
ALTER TABLE stop_orders
  ALTER COLUMN installation_id SET NOT NULL,
  ALTER COLUMN vintage_year SET NOT NULL;
ALTER TABLE match_events ALTER COLUMN vintage_year SET NOT NULL;
ALTER TABLE trades
  ALTER COLUMN buyer_installation_id SET NOT NULL,
  ALTER COLUMN seller_installation_id SET NOT NULL,
  ALTER COLUMN vintage_year SET NOT NULL;
ALTER TABLE settlement_instructions
  ALTER COLUMN buyer_installation_id SET NOT NULL,
  ALTER COLUMN seller_installation_id SET NOT NULL,
  ALTER COLUMN vintage_year SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limit_orders_installation_fk') THEN
    ALTER TABLE limit_orders ADD CONSTRAINT limit_orders_installation_fk
      FOREIGN KEY (installation_id, participant_id)
      REFERENCES installations(installation_id, participant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limit_orders_vintage_fk') THEN
    ALTER TABLE limit_orders ADD CONSTRAINT limit_orders_vintage_fk
      FOREIGN KEY (series_code, vintage_year)
      REFERENCES quota_vintages(series_code, vintage_year);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stop_orders_installation_fk') THEN
    ALTER TABLE stop_orders ADD CONSTRAINT stop_orders_installation_fk
      FOREIGN KEY (installation_id, participant_id)
      REFERENCES installations(installation_id, participant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stop_orders_vintage_fk') THEN
    ALTER TABLE stop_orders ADD CONSTRAINT stop_orders_vintage_fk
      FOREIGN KEY (series_code, vintage_year)
      REFERENCES quota_vintages(series_code, vintage_year);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_buyer_installation_fk') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_buyer_installation_fk
      FOREIGN KEY (buyer_installation_id, buyer_participant_id)
      REFERENCES installations(installation_id, participant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_seller_installation_fk') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_seller_installation_fk
      FOREIGN KEY (seller_installation_id, seller_participant_id)
      REFERENCES installations(installation_id, participant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trades_vintage_fk') THEN
    ALTER TABLE trades ADD CONSTRAINT trades_vintage_fk
      FOREIGN KEY (series_code, vintage_year)
      REFERENCES quota_vintages(series_code, vintage_year);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'match_events_vintage_fk') THEN
    ALTER TABLE match_events ADD CONSTRAINT match_events_vintage_fk
      FOREIGN KEY (series_code, vintage_year)
      REFERENCES quota_vintages(series_code, vintage_year);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_buyer_installation_fk') THEN
    ALTER TABLE settlement_instructions ADD CONSTRAINT settlements_buyer_installation_fk
      FOREIGN KEY (buyer_installation_id, buyer_participant_id)
      REFERENCES installations(installation_id, participant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_seller_installation_fk') THEN
    ALTER TABLE settlement_instructions ADD CONSTRAINT settlements_seller_installation_fk
      FOREIGN KEY (seller_installation_id, seller_participant_id)
      REFERENCES installations(installation_id, participant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlements_vintage_fk') THEN
    ALTER TABLE settlement_instructions ADD CONSTRAINT settlements_vintage_fk
      FOREIGN KEY (series_code, vintage_year)
      REFERENCES quota_vintages(series_code, vintage_year);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_limit_order_book_vintage
  ON limit_orders (series_code, compliance_period, vintage_year, side, limit_price, priority_sequence)
  WHERE status IN ('OPEN', 'PARTIALLY_FILLED') AND order_type = 'LIMIT';

CREATE INDEX IF NOT EXISTS idx_stop_trigger_book_vintage
  ON stop_orders (series_code, compliance_period, vintage_year, side, stop_price, priority_sequence)
  WHERE status = 'TRIGGER_PENDING';

CREATE INDEX IF NOT EXISTS idx_trades_market_vintage_sequence
  ON trades (series_code, compliance_period, vintage_year, trade_sequence);
