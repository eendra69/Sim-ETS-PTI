CREATE TABLE IF NOT EXISTS settlement_instructions (
  settlement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL UNIQUE REFERENCES trades(trade_id),
  buyer_participant_id text NOT NULL REFERENCES participants(participant_id),
  seller_participant_id text NOT NULL REFERENCES participants(participant_id),
  series_code text NOT NULL,
  compliance_period integer NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  cash_amount bigint NOT NULL CHECK (cash_amount > 0),
  settlement_type text NOT NULL DEFAULT 'T0_DVP' CHECK (settlement_type = 'T0_DVP'),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'SETTLED', 'FAILED', 'REVERSED')),
  ruleset_id text NOT NULL,
  correlation_id uuid NOT NULL,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  settled_at timestamptz,
  failed_at timestamptz,
  reversed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (buyer_participant_id <> seller_participant_id)
);

CREATE TABLE IF NOT EXISTS registry_messages (
  registry_message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL UNIQUE REFERENCES settlement_instructions(settlement_id),
  trade_id uuid NOT NULL UNIQUE REFERENCES trades(trade_id),
  message_type text NOT NULL DEFAULT 'TRANSFER_PTBAE_IND'
    CHECK (message_type = 'TRANSFER_PTBAE_IND'),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED', 'SENT', 'ACKNOWLEDGED', 'REJECTED', 'RETRY')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  acknowledged_quantity bigint,
  registry_reference text UNIQUE,
  error_message text,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  rejected_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlement_reconciliations (
  reconciliation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL UNIQUE REFERENCES settlement_instructions(settlement_id),
  registry_message_id uuid NOT NULL UNIQUE REFERENCES registry_messages(registry_message_id),
  trade_id uuid NOT NULL UNIQUE REFERENCES trades(trade_id),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'MATCHED', 'EXCEPTION', 'RESOLVED')),
  expected_quantity bigint NOT NULL CHECK (expected_quantity > 0),
  registry_quantity bigint,
  expected_cash bigint NOT NULL CHECK (expected_cash > 0),
  settled_cash bigint,
  registry_reference text,
  exception_reason text,
  ruleset_id text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  resolved_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlement_ledger_entries (
  ledger_entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id uuid NOT NULL REFERENCES settlement_instructions(settlement_id),
  trade_id uuid NOT NULL REFERENCES trades(trade_id),
  registry_message_id uuid NOT NULL REFERENCES registry_messages(registry_message_id),
  reconciliation_id uuid NOT NULL REFERENCES settlement_reconciliations(reconciliation_id),
  participant_id text NOT NULL REFERENCES participants(participant_id),
  leg_type text NOT NULL CHECK (leg_type IN ('UNIT', 'CASH')),
  delta bigint NOT NULL CHECK (delta <> 0),
  ruleset_id text NOT NULL,
  registry_reference text NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trade_id, participant_id, leg_type)
);

CREATE TABLE IF NOT EXISTS position_finalizations (
  trade_id uuid PRIMARY KEY REFERENCES trades(trade_id),
  settlement_id uuid NOT NULL UNIQUE REFERENCES settlement_instructions(settlement_id),
  registry_message_id uuid NOT NULL UNIQUE REFERENCES registry_messages(registry_message_id),
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES settlement_reconciliations(reconciliation_id),
  registry_reference text NOT NULL UNIQUE,
  ruleset_id text NOT NULL,
  correlation_id uuid NOT NULL,
  finalized_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS post_trade_commands (
  command_scope text NOT NULL,
  idempotency_key text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (command_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_settlement_market
  ON settlement_instructions (series_code, compliance_period, created_at, settlement_id);

CREATE INDEX IF NOT EXISTS idx_registry_status
  ON registry_messages (status, created_at, registry_message_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_status
  ON settlement_reconciliations (status, created_at, reconciliation_id);

CREATE INDEX IF NOT EXISTS idx_settlement_ledger_participant
  ON settlement_ledger_entries (participant_id, created_at, ledger_entry_id);
