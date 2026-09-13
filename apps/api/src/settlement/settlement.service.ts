import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { KeyedMutex } from '../common/keyed-mutex';
import { LimitOrderService } from '../limit-order/limit-order.service';
import { Trade } from '../limit-order/limit-order.types';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import {
  AcknowledgeRegistryDto,
  FailSettlementDto,
  IdempotentCommandDto,
  RejectRegistryDto,
  ResolveReconciliationDto,
} from './dto/settlement-command.dto';
import {
  RegistryMessage,
  ReconciliationStatus,
  SettlementBundle,
  SettlementInstruction,
  SettlementLedgerEntry,
  SettlementReconciliation,
} from './settlement.types';

interface SettlementRow extends QueryResultRow {
  settlement_id: string; trade_id: string; buyer_participant_id: string; seller_participant_id: string;
  series_code: string; compliance_period: number; quantity: string; cash_amount: string;
  settlement_type: 'T0_DVP'; status: SettlementInstruction['status']; ruleset_id: string;
  correlation_id: string; failure_reason: string | null; created_at: Date; processed_at: Date | null;
  settled_at: Date | null; failed_at: Date | null; reversed_at: Date | null; updated_at: Date;
}

interface RegistryRow extends QueryResultRow {
  registry_message_id: string; settlement_id: string; trade_id: string;
  message_type: 'TRANSFER_PTBAE_IND'; status: RegistryMessage['status']; attempt_count: number;
  acknowledged_quantity: string | null; registry_reference: string | null; error_message: string | null;
  correlation_id: string; created_at: Date; sent_at: Date | null; acknowledged_at: Date | null;
  rejected_at: Date | null; updated_at: Date;
}

interface ReconciliationRow extends QueryResultRow {
  reconciliation_id: string; settlement_id: string; registry_message_id: string; trade_id: string;
  status: ReconciliationStatus; expected_quantity: string; registry_quantity: string | null;
  expected_cash: string; settled_cash: string | null; registry_reference: string | null;
  exception_reason: string | null; ruleset_id: string; correlation_id: string; created_at: Date;
  reconciled_at: Date | null; resolved_at: Date | null; updated_at: Date;
}

interface LedgerRow extends QueryResultRow {
  ledger_entry_id: string; settlement_id: string; trade_id: string; registry_message_id: string;
  reconciliation_id: string; participant_id: string; leg_type: 'UNIT' | 'CASH'; delta: string;
  ruleset_id: string; registry_reference: string; correlation_id: string; created_at: Date;
}

interface CommandRecord {
  aggregateId: string;
  fingerprint: string;
}

@Injectable()
export class SettlementService implements OnModuleDestroy {
  private readonly settlements = new Map<string, SettlementInstruction>();
  private readonly registryMessages = new Map<string, RegistryMessage>();
  private readonly reconciliations = new Map<string, SettlementReconciliation>();
  private readonly ledgerEntries: SettlementLedgerEntry[] = [];
  private readonly finalizedTrades = new Set<string>();
  private readonly commands = new Map<string, CommandRecord>();
  private readonly mutex = new KeyedMutex();
  private readonly pool?: Pool;

  constructor(
    private readonly limitOrderService: LimitOrderService,
    private readonly positionBalanceService: PositionBalanceService,
  ) {
    const usePostgres =
      process.env.NODE_ENV !== 'test' && process.env.PERSISTENCE_MODE === 'postgres';
    if (usePostgres) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  private async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async createFromTrade(tradeId: string, dto: IdempotentCommandDto): Promise<SettlementBundle> {
    const trade = await this.limitOrderService.getTrade(tradeId);
    const fingerprint = this.fingerprint({ tradeId });
    if (this.pool) {
      return this.withTransaction(async (client) => {
        const existingCommand = await this.claimDbCommand(
          client, 'SETTLEMENT_CREATE', dto.idempotencyKey, randomUUID(), fingerprint,
        );
        if (!existingCommand.created) return this.getDbBundle(client, existingCommand.aggregateId);

        await client.query('SELECT 1 FROM trades WHERE trade_id=$1 FOR UPDATE', [tradeId]);

        const existing = await client.query<SettlementRow>(
          'SELECT * FROM settlement_instructions WHERE trade_id = $1 FOR UPDATE', [tradeId],
        );
        if (existing.rows[0]) {
          await this.repointDbCommand(client, 'SETTLEMENT_CREATE', dto.idempotencyKey, existing.rows[0].settlement_id);
          return this.getDbBundle(client, existing.rows[0].settlement_id);
        }
        const settlementId = existingCommand.aggregateId;
        const correlationId = randomUUID();
        const registryMessageId = randomUUID();
        const reconciliationId = randomUUID();
        await client.query(
          `INSERT INTO settlement_instructions (
             settlement_id, trade_id, buyer_participant_id, seller_participant_id, series_code,
             compliance_period, quantity, cash_amount, ruleset_id, correlation_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [settlementId, trade.tradeId, trade.buyerParticipantId, trade.sellerParticipantId,
            trade.seriesCode, trade.compliancePeriod, trade.quantity, trade.notional,
            trade.rulesetId, correlationId],
        );
        await client.query(
          `INSERT INTO registry_messages (
             registry_message_id, settlement_id, trade_id, correlation_id
           ) VALUES ($1,$2,$3,$4)`,
          [registryMessageId, settlementId, trade.tradeId, correlationId],
        );
        await client.query(
          `INSERT INTO settlement_reconciliations (
             reconciliation_id, settlement_id, registry_message_id, trade_id, expected_quantity,
             expected_cash, ruleset_id, correlation_id
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [reconciliationId, settlementId, registryMessageId, trade.tradeId, trade.quantity,
            trade.notional, trade.rulesetId, correlationId],
        );
        return this.getDbBundle(client, settlementId);
      });
    }

    return this.mutex.runExclusive(`trade:${tradeId}`, () => {
      const command = this.claimMemoryCommand('SETTLEMENT_CREATE', dto.idempotencyKey, randomUUID(), fingerprint);
      if (!command.created) return this.getMemoryBundle(command.aggregateId);
      const existing = [...this.settlements.values()].find((item) => item.tradeId === tradeId);
      if (existing) {
        this.commands.set(`SETTLEMENT_CREATE:${dto.idempotencyKey}`, { aggregateId: existing.settlementId, fingerprint });
        return this.getMemoryBundle(existing.settlementId);
      }
      const now = new Date().toISOString();
      const correlationId = randomUUID();
      const settlement: SettlementInstruction = {
        settlementId: command.aggregateId, tradeId, buyerParticipantId: trade.buyerParticipantId,
        sellerParticipantId: trade.sellerParticipantId, seriesCode: trade.seriesCode,
        compliancePeriod: trade.compliancePeriod, quantity: trade.quantity, cashAmount: trade.notional,
        settlementType: 'T0_DVP', status: 'PENDING', rulesetId: trade.rulesetId,
        correlationId, createdAt: now, updatedAt: now,
      };
      const registryMessage: RegistryMessage = {
        registryMessageId: randomUUID(), settlementId: settlement.settlementId, tradeId,
        messageType: 'TRANSFER_PTBAE_IND', status: 'QUEUED', attemptCount: 0,
        correlationId, createdAt: now, updatedAt: now,
      };
      const reconciliation: SettlementReconciliation = {
        reconciliationId: randomUUID(), settlementId: settlement.settlementId,
        registryMessageId: registryMessage.registryMessageId, tradeId, status: 'OPEN',
        expectedQuantity: trade.quantity, expectedCash: trade.notional, rulesetId: trade.rulesetId,
        correlationId, createdAt: now, updatedAt: now,
      };
      this.settlements.set(settlement.settlementId, settlement);
      this.registryMessages.set(registryMessage.registryMessageId, registryMessage);
      this.reconciliations.set(reconciliation.reconciliationId, reconciliation);
      return this.getMemoryBundle(settlement.settlementId);
    });
  }

  async list(seriesCode: string, compliancePeriod: number): Promise<SettlementBundle[]> {
    if (!this.pool) {
      return [...this.settlements.values()]
        .filter((item) => item.seriesCode === seriesCode && item.compliancePeriod === compliancePeriod)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((item) => this.getMemoryBundle(item.settlementId));
    }
    const rows = await this.pool.query<SettlementRow>(
      `SELECT * FROM settlement_instructions WHERE series_code=$1 AND compliance_period=$2
       ORDER BY created_at, settlement_id`, [seriesCode, compliancePeriod],
    );
    return Promise.all(rows.rows.map((row) => this.getDbBundle(this.pool!, row.settlement_id)));
  }

  async get(settlementId: string): Promise<SettlementBundle> {
    return this.pool ? this.getDbBundle(this.pool, settlementId) : this.getMemoryBundle(settlementId);
  }

  async process(settlementId: string, dto: IdempotentCommandDto): Promise<SettlementBundle> {
    return this.mutateSettlement(settlementId, 'SETTLEMENT_PROCESS', dto.idempotencyKey, {},
      (settlement, now) => {
        if (settlement.status === 'SETTLED') return;
        if (settlement.status !== 'PENDING') this.invalidState('Settlement', settlement.status, 'PENDING');
        settlement.status = 'PROCESSING';
        settlement.processedAt = now;
        settlement.status = 'SETTLED';
        settlement.settledAt = now;
        settlement.failureReason = undefined;
        settlement.failedAt = undefined;
      },
      `UPDATE settlement_instructions SET status='SETTLED', processed_at=now(), settled_at=now(),
       failure_reason=NULL, failed_at=NULL, updated_at=now()
       WHERE settlement_id=$1 AND status='PENDING'`,
    );
  }

  async fail(settlementId: string, dto: FailSettlementDto): Promise<SettlementBundle> {
    return this.mutateSettlement(settlementId, 'SETTLEMENT_FAIL', dto.idempotencyKey,
      { reason: dto.reason },
      (settlement, now) => {
        if (settlement.status === 'FAILED' && settlement.failureReason === dto.reason) return;
        if (settlement.status !== 'PENDING') this.invalidState('Settlement', settlement.status, 'PENDING');
        settlement.status = 'FAILED'; settlement.failureReason = dto.reason;
        settlement.failedAt = now;
      },
      `UPDATE settlement_instructions SET status='FAILED', failure_reason=$2, failed_at=now(), updated_at=now()
       WHERE settlement_id=$1 AND status='PENDING'`, [dto.reason],
    );
  }

  async retrySettlement(settlementId: string, dto: IdempotentCommandDto): Promise<SettlementBundle> {
    return this.mutateSettlement(settlementId, 'SETTLEMENT_RETRY', dto.idempotencyKey, {},
      (settlement) => {
        if (settlement.status === 'PENDING') return;
        if (settlement.status !== 'FAILED') this.invalidState('Settlement', settlement.status, 'FAILED');
        settlement.status = 'PENDING'; settlement.failureReason = undefined; settlement.failedAt = undefined;
      },
      `UPDATE settlement_instructions SET status='PENDING', failure_reason=NULL, failed_at=NULL, updated_at=now()
       WHERE settlement_id=$1 AND status='FAILED'`,
    );
  }

  async reverse(settlementId: string, dto: IdempotentCommandDto): Promise<SettlementBundle> {
    const bundle = await this.get(settlementId);
    if (bundle.finalized) throw new ConflictException({ code: 'SET-FINALIZED', message: 'A finalized settlement cannot be reversed; use a corrective trade' });
    return this.mutateSettlement(settlementId, 'SETTLEMENT_REVERSE', dto.idempotencyKey, {},
      (settlement, now) => {
        if (settlement.status === 'REVERSED') return;
        if (settlement.status !== 'SETTLED') this.invalidState('Settlement', settlement.status, 'SETTLED');
        settlement.status = 'REVERSED'; settlement.reversedAt = now;
      },
      `UPDATE settlement_instructions SET status='REVERSED', reversed_at=now(), updated_at=now()
       WHERE settlement_id=$1 AND status='SETTLED'
         AND NOT EXISTS (SELECT 1 FROM position_finalizations WHERE settlement_id=$1)`,
    );
  }

  async sendRegistry(registryMessageId: string, dto: IdempotentCommandDto): Promise<SettlementBundle> {
    return this.mutateRegistry(registryMessageId, 'REGISTRY_SEND', dto.idempotencyKey, {},
      (message, settlement, reconciliation, now) => {
        if (message.status === 'SENT') return;
        if (settlement.status !== 'SETTLED') this.invalidState('Settlement', settlement.status, 'SETTLED');
        if (!['QUEUED', 'RETRY'].includes(message.status)) this.invalidState('Registry message', message.status, 'QUEUED or RETRY');
        message.status = 'SENT'; message.attemptCount += 1; message.sentAt = now;
        message.errorMessage = undefined; message.rejectedAt = undefined;
        reconciliation.status = 'OPEN'; reconciliation.exceptionReason = undefined;
      },
      async (client, message) => {
        const updated = await client.query(
          `UPDATE registry_messages SET status='SENT', attempt_count=attempt_count+1, sent_at=now(),
           error_message=NULL, rejected_at=NULL, updated_at=now()
           WHERE registry_message_id=$1 AND status IN ('QUEUED','RETRY')`, [registryMessageId],
        );
        if (updated.rowCount) await client.query(
          `UPDATE settlement_reconciliations SET status='OPEN', exception_reason=NULL, updated_at=now()
           WHERE registry_message_id=$1`, [registryMessageId],
        );
        void message;
      },
    );
  }

  async acknowledgeRegistry(registryMessageId: string, dto: AcknowledgeRegistryDto): Promise<SettlementBundle> {
    return this.finalizeRegistry(registryMessageId, dto, false);
  }

  async rejectRegistry(registryMessageId: string, dto: RejectRegistryDto): Promise<SettlementBundle> {
    return this.mutateRegistry(registryMessageId, 'REGISTRY_REJECT', dto.idempotencyKey,
      { reason: dto.reason },
      (message, _settlement, reconciliation, now) => {
        if (message.status === 'REJECTED' && message.errorMessage === dto.reason) return;
        if (message.status !== 'SENT') this.invalidState('Registry message', message.status, 'SENT');
        message.status = 'REJECTED'; message.errorMessage = dto.reason; message.rejectedAt = now;
        reconciliation.status = 'EXCEPTION'; reconciliation.exceptionReason = dto.reason;
      },
      async (client) => {
        const updated = await client.query(
          `UPDATE registry_messages SET status='REJECTED', error_message=$2, rejected_at=now(), updated_at=now()
           WHERE registry_message_id=$1 AND status='SENT'`, [registryMessageId, dto.reason],
        );
        if (updated.rowCount) await client.query(
          `UPDATE settlement_reconciliations SET status='EXCEPTION', exception_reason=$2, updated_at=now()
           WHERE registry_message_id=$1`, [registryMessageId, dto.reason],
        );
      },
    );
  }

  async retryRegistry(registryMessageId: string, dto: IdempotentCommandDto): Promise<SettlementBundle> {
    return this.mutateRegistry(registryMessageId, 'REGISTRY_RETRY', dto.idempotencyKey, {},
      (message) => {
        if (message.status === 'RETRY') return;
        if (message.status !== 'REJECTED') this.invalidState('Registry message', message.status, 'REJECTED');
        message.status = 'RETRY'; message.acknowledgedQuantity = undefined;
        message.registryReference = undefined; message.errorMessage = undefined;
      },
      async (client) => {
        await client.query(
          `UPDATE registry_messages SET status='RETRY', acknowledged_quantity=NULL, registry_reference=NULL,
           error_message=NULL, updated_at=now() WHERE registry_message_id=$1 AND status='REJECTED'`,
          [registryMessageId],
        );
      },
    );
  }

  async resolveReconciliation(
    reconciliationId: string,
    dto: ResolveReconciliationDto,
  ): Promise<SettlementBundle> {
    const bundle = this.pool
      ? await this.getDbBundleByReconciliation(this.pool, reconciliationId)
      : this.getMemoryBundleByReconciliation(reconciliationId);
    if (bundle.reconciliation.status !== 'EXCEPTION') {
      this.invalidState('Reconciliation', bundle.reconciliation.status, 'EXCEPTION');
    }
    if (dto.acknowledgedQuantity !== bundle.reconciliation.expectedQuantity) {
      throw new BadRequestException({ code: 'REC-QUANTITY-MISMATCH', message: 'Manual resolution quantity must equal the trade quantity' });
    }
    return this.finalizeRegistry(bundle.registryMessage.registryMessageId, dto, true);
  }

  private async finalizeRegistry(
    registryMessageId: string,
    dto: AcknowledgeRegistryDto,
    manualResolution: boolean,
  ): Promise<SettlementBundle> {
    const scope = manualResolution ? 'RECONCILIATION_RESOLVE' : 'REGISTRY_ACK';
    const fingerprint = this.fingerprint({ registryReference: dto.registryReference, acknowledgedQuantity: dto.acknowledgedQuantity });
    if (this.pool) {
      return this.withTransaction(async (client) => {
        const locked = await this.getDbBundleByRegistry(client, registryMessageId, true);
        const command = await this.claimDbCommand(client, scope, dto.idempotencyKey,
          manualResolution ? locked.reconciliation.reconciliationId : registryMessageId, fingerprint);
        if (!command.created) return this.getDbBundleByRegistry(client, registryMessageId);
        if (locked.finalized) {
          this.assertSameAcknowledgement(locked, dto);
          return locked;
        }
        if (locked.settlement.status !== 'SETTLED') this.invalidState('Settlement', locked.settlement.status, 'SETTLED');
        const validState = manualResolution ? locked.reconciliation.status === 'EXCEPTION' : locked.registryMessage.status === 'SENT';
        if (!validState) this.invalidState(manualResolution ? 'Reconciliation' : 'Registry message',
          manualResolution ? locked.reconciliation.status : locked.registryMessage.status,
          manualResolution ? 'EXCEPTION' : 'SENT');

        if (dto.acknowledgedQuantity !== locked.settlement.quantity && !manualResolution) {
          const reason = `SRUK quantity ${dto.acknowledgedQuantity} does not match trade quantity ${locked.settlement.quantity}`;
          await client.query(
            `UPDATE registry_messages SET status='REJECTED', acknowledged_quantity=$2,
             error_message=$3, rejected_at=now(), updated_at=now() WHERE registry_message_id=$1`,
            [registryMessageId, dto.acknowledgedQuantity, reason],
          );
          await client.query(
            `UPDATE settlement_reconciliations SET status='EXCEPTION', registry_quantity=$2,
             exception_reason=$3, updated_at=now() WHERE registry_message_id=$1`,
            [registryMessageId, dto.acknowledgedQuantity, reason],
          );
          return this.getDbBundleByRegistry(client, registryMessageId);
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dto.registryReference]);
        const duplicateReference = await client.query(
          `SELECT 1 FROM registry_messages
           WHERE registry_reference=$1 AND registry_message_id<>$2`,
          [dto.registryReference, registryMessageId],
        );
        if (duplicateReference.rows[0]) this.duplicateRegistryReference();
        await this.applyDbFinality(client, locked, dto, manualResolution);
        return this.getDbBundleByRegistry(client, registryMessageId);
      });
    }

    return this.mutex.runExclusive(`registry:${registryMessageId}`, async () => {
      const bundle = this.getMutableMemoryBundleByRegistry(registryMessageId);
      const command = this.claimMemoryCommand(scope, dto.idempotencyKey,
        manualResolution ? bundle.reconciliation.reconciliationId : registryMessageId, fingerprint);
      if (!command.created) return this.getMemoryBundleByRegistry(registryMessageId);
      try {
        if (bundle.finalized) {
          this.assertSameAcknowledgement(bundle, dto);
          return bundle;
        }
        if (bundle.settlement.status !== 'SETTLED') this.invalidState('Settlement', bundle.settlement.status, 'SETTLED');
        const validState = manualResolution ? bundle.reconciliation.status === 'EXCEPTION' : bundle.registryMessage.status === 'SENT';
        if (!validState) this.invalidState(manualResolution ? 'Reconciliation' : 'Registry message',
          manualResolution ? bundle.reconciliation.status : bundle.registryMessage.status,
          manualResolution ? 'EXCEPTION' : 'SENT');
        const now = new Date().toISOString();
        if (dto.acknowledgedQuantity !== bundle.settlement.quantity && !manualResolution) {
          const reason = `SRUK quantity ${dto.acknowledgedQuantity} does not match trade quantity ${bundle.settlement.quantity}`;
          Object.assign(bundle.registryMessage, { status: 'REJECTED', acknowledgedQuantity: dto.acknowledgedQuantity,
            errorMessage: reason, rejectedAt: now, updatedAt: now });
          Object.assign(bundle.reconciliation, { status: 'EXCEPTION', registryQuantity: dto.acknowledgedQuantity,
            exceptionReason: reason, updatedAt: now });
          return this.getMemoryBundle(bundle.settlement.settlementId);
        }
        const duplicateReference = [...this.registryMessages.values()].some(
          (message) =>
            message.registryMessageId !== registryMessageId &&
            message.registryReference === dto.registryReference,
        );
        if (duplicateReference) this.duplicateRegistryReference();
        await this.positionBalanceService.finalizeSettledTrade(this.transferOf(bundle.settlement));
        this.finalizedTrades.add(bundle.settlement.tradeId);
        Object.assign(bundle.registryMessage, { status: 'ACKNOWLEDGED', acknowledgedQuantity: dto.acknowledgedQuantity,
          registryReference: dto.registryReference, errorMessage: undefined, acknowledgedAt: now, updatedAt: now });
        Object.assign(bundle.reconciliation, { status: manualResolution ? 'RESOLVED' : 'MATCHED',
          registryQuantity: dto.acknowledgedQuantity, settledCash: bundle.settlement.cashAmount,
          registryReference: dto.registryReference, exceptionReason: undefined, reconciledAt: now,
          ...(manualResolution ? { resolvedAt: now } : {}), updatedAt: now });
        this.createMemoryLedgerEntries(bundle, dto.registryReference, now);
        return this.getMemoryBundle(bundle.settlement.settlementId);
      } catch (error) {
        this.commands.delete(`${scope}:${dto.idempotencyKey}`);
        throw error;
      }
    });
  }

  private async applyDbFinality(
    client: PoolClient,
    bundle: SettlementBundle,
    dto: AcknowledgeRegistryDto,
    manualResolution: boolean,
  ): Promise<void> {
    await this.positionBalanceService.finalizeSettledTrade(this.transferOf(bundle.settlement), client);
    await client.query(
      `INSERT INTO position_finalizations (
         trade_id, settlement_id, registry_message_id, reconciliation_id, registry_reference,
         ruleset_id, correlation_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [bundle.settlement.tradeId, bundle.settlement.settlementId, bundle.registryMessage.registryMessageId,
        bundle.reconciliation.reconciliationId, dto.registryReference, bundle.settlement.rulesetId,
        bundle.settlement.correlationId],
    );
    const entries = this.ledgerValues(bundle, dto.registryReference);
    for (const entry of entries) {
      await client.query(
        `INSERT INTO settlement_ledger_entries (
           settlement_id, trade_id, registry_message_id, reconciliation_id, participant_id,
           leg_type, delta, ruleset_id, registry_reference, correlation_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, entry,
      );
    }
    await client.query(
      `UPDATE registry_messages SET status='ACKNOWLEDGED', acknowledged_quantity=$2,
       registry_reference=$3, error_message=NULL, acknowledged_at=now(), updated_at=now()
       WHERE registry_message_id=$1`,
      [bundle.registryMessage.registryMessageId, dto.acknowledgedQuantity, dto.registryReference],
    );
    await client.query(
      `UPDATE settlement_reconciliations SET status=$2, registry_quantity=$3, settled_cash=expected_cash,
       registry_reference=$4, exception_reason=NULL, reconciled_at=now(),
       resolved_at=CASE WHEN $2='RESOLVED' THEN now() ELSE resolved_at END, updated_at=now()
       WHERE reconciliation_id=$1`,
      [bundle.reconciliation.reconciliationId, manualResolution ? 'RESOLVED' : 'MATCHED',
        dto.acknowledgedQuantity, dto.registryReference],
    );
  }

  private async mutateSettlement(
    settlementId: string, scope: string, idempotencyKey: string, payload: object,
    memoryMutation: (settlement: SettlementInstruction, now: string) => void,
    sql: string, extraParams: unknown[] = [],
  ): Promise<SettlementBundle> {
    const fingerprint = this.fingerprint(payload);
    if (this.pool) return this.withTransaction(async (client) => {
      const bundle = await this.getDbBundle(client, settlementId, true);
      const command = await this.claimDbCommand(client, scope, idempotencyKey, settlementId, fingerprint);
      if (!command.created) return bundle;
      const result = await client.query(sql, [settlementId, ...extraParams]);
      if (!result.rowCount) {
        const current = await this.getDbBundle(client, settlementId);
        memoryMutation({ ...current.settlement }, new Date().toISOString());
      }
      return this.getDbBundle(client, settlementId);
    });
    return this.mutex.runExclusive(`settlement:${settlementId}`, () => {
      const command = this.claimMemoryCommand(scope, idempotencyKey, settlementId, fingerprint);
      if (!command.created) return this.getMemoryBundle(settlementId);
      try {
        const settlement = this.requireMemorySettlement(settlementId);
        memoryMutation(settlement, new Date().toISOString());
        settlement.updatedAt = new Date().toISOString();
        return this.getMemoryBundle(settlementId);
      } catch (error) {
        this.commands.delete(`${scope}:${idempotencyKey}`);
        throw error;
      }
    });
  }

  private async mutateRegistry(
    registryMessageId: string, scope: string, idempotencyKey: string, payload: object,
    memoryMutation: (message: RegistryMessage, settlement: SettlementInstruction,
      reconciliation: SettlementReconciliation, now: string) => void,
    dbMutation: (client: PoolClient, message: RegistryMessage) => Promise<void>,
  ): Promise<SettlementBundle> {
    const fingerprint = this.fingerprint(payload);
    if (this.pool) return this.withTransaction(async (client) => {
      const bundle = await this.getDbBundleByRegistry(client, registryMessageId, true);
      const command = await this.claimDbCommand(client, scope, idempotencyKey, registryMessageId, fingerprint);
      if (!command.created) return bundle;
      const simulated = structuredClone(bundle);
      memoryMutation(simulated.registryMessage, simulated.settlement, simulated.reconciliation, new Date().toISOString());
      await dbMutation(client, bundle.registryMessage);
      return this.getDbBundleByRegistry(client, registryMessageId);
    });
    return this.mutex.runExclusive(`registry:${registryMessageId}`, () => {
      const command = this.claimMemoryCommand(scope, idempotencyKey, registryMessageId, fingerprint);
      if (!command.created) return this.getMemoryBundleByRegistry(registryMessageId);
      try {
        const bundle = this.getMutableMemoryBundleByRegistry(registryMessageId);
        const now = new Date().toISOString();
        memoryMutation(bundle.registryMessage, bundle.settlement, bundle.reconciliation, now);
        bundle.registryMessage.updatedAt = now;
        bundle.reconciliation.updatedAt = now;
        return this.getMemoryBundle(bundle.settlement.settlementId);
      } catch (error) {
        this.commands.delete(`${scope}:${idempotencyKey}`);
        throw error;
      }
    });
  }

  private transferOf(settlement: SettlementInstruction) {
    return { tradeId: settlement.tradeId, buyerParticipantId: settlement.buyerParticipantId,
      sellerParticipantId: settlement.sellerParticipantId, seriesCode: settlement.seriesCode,
      compliancePeriod: settlement.compliancePeriod, quantity: settlement.quantity,
      notional: settlement.cashAmount };
  }

  private ledgerValues(bundle: SettlementBundle, registryReference: string): unknown[][] {
    const base = [bundle.settlement.settlementId, bundle.settlement.tradeId,
      bundle.registryMessage.registryMessageId, bundle.reconciliation.reconciliationId];
    const tail = [bundle.settlement.rulesetId, registryReference, bundle.settlement.correlationId];
    return [
      [...base, bundle.settlement.buyerParticipantId, 'UNIT', bundle.settlement.quantity, ...tail],
      [...base, bundle.settlement.sellerParticipantId, 'UNIT', -bundle.settlement.quantity, ...tail],
      [...base, bundle.settlement.buyerParticipantId, 'CASH', -bundle.settlement.cashAmount, ...tail],
      [...base, bundle.settlement.sellerParticipantId, 'CASH', bundle.settlement.cashAmount, ...tail],
    ];
  }

  private createMemoryLedgerEntries(bundle: SettlementBundle, registryReference: string, now: string): void {
    for (const values of this.ledgerValues(bundle, registryReference)) {
      const [settlementId, tradeId, registryMessageId, reconciliationId, participantId,
        legType, delta, rulesetId, reference, correlationId] = values as [string,string,string,string,string,'UNIT'|'CASH',number,string,string,string];
      this.ledgerEntries.push({ ledgerEntryId: randomUUID(), settlementId, tradeId, registryMessageId,
        reconciliationId, participantId, legType, delta, rulesetId,
        registryReference: reference, correlationId, createdAt: now });
    }
  }

  private getMemoryBundle(settlementId: string): SettlementBundle {
    const settlement = this.requireMemorySettlement(settlementId);
    const message = [...this.registryMessages.values()].find((item) => item.settlementId === settlementId);
    const reconciliation = [...this.reconciliations.values()].find((item) => item.settlementId === settlementId);
    if (!message || !reconciliation) throw new Error(`Incomplete settlement aggregate ${settlementId}`);
    return { settlement: { ...settlement }, registryMessage: { ...message },
      reconciliation: { ...reconciliation },
      ledgerEntries: this.ledgerEntries.filter((entry) => entry.settlementId === settlementId).map((entry) => ({ ...entry })),
      finalized: this.finalizedTrades.has(settlement.tradeId) };
  }

  private getMemoryBundleByRegistry(registryMessageId: string): SettlementBundle {
    const message = this.registryMessages.get(registryMessageId);
    if (!message) throw new NotFoundException(`Registry message ${registryMessageId} was not found`);
    return this.getMemoryBundle(message.settlementId);
  }

  private getMutableMemoryBundleByRegistry(registryMessageId: string): SettlementBundle {
    const registryMessage = this.registryMessages.get(registryMessageId);
    if (!registryMessage) throw new NotFoundException(`Registry message ${registryMessageId} was not found`);
    const settlement = this.requireMemorySettlement(registryMessage.settlementId);
    const reconciliation = [...this.reconciliations.values()].find(
      (item) => item.settlementId === settlement.settlementId,
    );
    if (!reconciliation) throw new Error(`Incomplete settlement aggregate ${settlement.settlementId}`);
    return {
      settlement,
      registryMessage,
      reconciliation,
      ledgerEntries: this.ledgerEntries.filter((entry) => entry.settlementId === settlement.settlementId),
      finalized: this.finalizedTrades.has(settlement.tradeId),
    };
  }

  private getMemoryBundleByReconciliation(reconciliationId: string): SettlementBundle {
    const reconciliation = this.reconciliations.get(reconciliationId);
    if (!reconciliation) throw new NotFoundException(`Reconciliation ${reconciliationId} was not found`);
    return this.getMemoryBundle(reconciliation.settlementId);
  }

  private requireMemorySettlement(settlementId: string): SettlementInstruction {
    const settlement = this.settlements.get(settlementId);
    if (!settlement) throw new NotFoundException(`Settlement ${settlementId} was not found`);
    return settlement;
  }

  private async getDbBundle(
    queryable: Pick<Pool, 'query'> | PoolClient,
    settlementId: string,
    lock = false,
  ): Promise<SettlementBundle> {
    const settlements = await queryable.query<SettlementRow>(
      `SELECT * FROM settlement_instructions WHERE settlement_id=$1${lock ? ' FOR UPDATE' : ''}`,
      [settlementId],
    );
    if (!settlements.rows[0]) throw new NotFoundException(`Settlement ${settlementId} was not found`);
    const messages = await queryable.query<RegistryRow>('SELECT * FROM registry_messages WHERE settlement_id=$1', [settlementId]);
    const reconciliations = await queryable.query<ReconciliationRow>('SELECT * FROM settlement_reconciliations WHERE settlement_id=$1', [settlementId]);
    const ledger = await queryable.query<LedgerRow>('SELECT * FROM settlement_ledger_entries WHERE settlement_id=$1 ORDER BY created_at, ledger_entry_id', [settlementId]);
    const final = await queryable.query('SELECT 1 FROM position_finalizations WHERE settlement_id=$1', [settlementId]);
    return { settlement: this.mapSettlement(settlements.rows[0]), registryMessage: this.mapRegistry(messages.rows[0]!),
      reconciliation: this.mapReconciliation(reconciliations.rows[0]!), ledgerEntries: ledger.rows.map((row) => this.mapLedger(row)),
      finalized: Boolean(final.rows[0]) };
  }

  private async getDbBundleByRegistry(queryable: Pick<Pool, 'query'> | PoolClient, registryMessageId: string, lock = false): Promise<SettlementBundle> {
    const rows = await queryable.query<RegistryRow>(
      `SELECT * FROM registry_messages WHERE registry_message_id=$1${lock ? ' FOR UPDATE' : ''}`, [registryMessageId]);
    if (!rows.rows[0]) throw new NotFoundException(`Registry message ${registryMessageId} was not found`);
    return this.getDbBundle(queryable, rows.rows[0].settlement_id, lock);
  }

  private async getDbBundleByReconciliation(queryable: Pick<Pool, 'query'> | PoolClient, reconciliationId: string): Promise<SettlementBundle> {
    const rows = await queryable.query<ReconciliationRow>('SELECT * FROM settlement_reconciliations WHERE reconciliation_id=$1', [reconciliationId]);
    if (!rows.rows[0]) throw new NotFoundException(`Reconciliation ${reconciliationId} was not found`);
    return this.getDbBundle(queryable, rows.rows[0].settlement_id);
  }

  private mapSettlement(row: SettlementRow): SettlementInstruction {
    return { settlementId: row.settlement_id, tradeId: row.trade_id, buyerParticipantId: row.buyer_participant_id,
      sellerParticipantId: row.seller_participant_id, seriesCode: row.series_code,
      compliancePeriod: row.compliance_period, quantity: this.number(row.quantity), cashAmount: this.number(row.cash_amount),
      settlementType: row.settlement_type, status: row.status, rulesetId: row.ruleset_id,
      correlationId: row.correlation_id, ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
      createdAt: row.created_at.toISOString(), ...(row.processed_at ? { processedAt: row.processed_at.toISOString() } : {}),
      ...(row.settled_at ? { settledAt: row.settled_at.toISOString() } : {}),
      ...(row.failed_at ? { failedAt: row.failed_at.toISOString() } : {}),
      ...(row.reversed_at ? { reversedAt: row.reversed_at.toISOString() } : {}), updatedAt: row.updated_at.toISOString() };
  }

  private mapRegistry(row: RegistryRow): RegistryMessage {
    return { registryMessageId: row.registry_message_id, settlementId: row.settlement_id, tradeId: row.trade_id,
      messageType: row.message_type, status: row.status, attemptCount: row.attempt_count,
      ...(row.acknowledged_quantity ? { acknowledgedQuantity: this.number(row.acknowledged_quantity) } : {}),
      ...(row.registry_reference ? { registryReference: row.registry_reference } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}), correlationId: row.correlation_id,
      createdAt: row.created_at.toISOString(), ...(row.sent_at ? { sentAt: row.sent_at.toISOString() } : {}),
      ...(row.acknowledged_at ? { acknowledgedAt: row.acknowledged_at.toISOString() } : {}),
      ...(row.rejected_at ? { rejectedAt: row.rejected_at.toISOString() } : {}), updatedAt: row.updated_at.toISOString() };
  }

  private mapReconciliation(row: ReconciliationRow): SettlementReconciliation {
    return { reconciliationId: row.reconciliation_id, settlementId: row.settlement_id,
      registryMessageId: row.registry_message_id, tradeId: row.trade_id, status: row.status,
      expectedQuantity: this.number(row.expected_quantity), ...(row.registry_quantity ? { registryQuantity: this.number(row.registry_quantity) } : {}),
      expectedCash: this.number(row.expected_cash), ...(row.settled_cash ? { settledCash: this.number(row.settled_cash) } : {}),
      ...(row.registry_reference ? { registryReference: row.registry_reference } : {}),
      ...(row.exception_reason ? { exceptionReason: row.exception_reason } : {}), rulesetId: row.ruleset_id,
      correlationId: row.correlation_id, createdAt: row.created_at.toISOString(),
      ...(row.reconciled_at ? { reconciledAt: row.reconciled_at.toISOString() } : {}),
      ...(row.resolved_at ? { resolvedAt: row.resolved_at.toISOString() } : {}), updatedAt: row.updated_at.toISOString() };
  }

  private mapLedger(row: LedgerRow): SettlementLedgerEntry {
    return { ledgerEntryId: row.ledger_entry_id, settlementId: row.settlement_id, tradeId: row.trade_id,
      registryMessageId: row.registry_message_id, reconciliationId: row.reconciliation_id,
      participantId: row.participant_id, legType: row.leg_type, delta: this.number(row.delta),
      rulesetId: row.ruleset_id, registryReference: row.registry_reference,
      correlationId: row.correlation_id, createdAt: row.created_at.toISOString() };
  }

  private claimMemoryCommand(scope: string, key: string, aggregateId: string, fingerprint: string) {
    const commandKey = `${scope}:${key}`;
    const existing = this.commands.get(commandKey);
    if (existing) {
      if (
        (existing.aggregateId !== aggregateId && scope !== 'SETTLEMENT_CREATE') ||
        existing.fingerprint !== fingerprint
      ) this.idempotencyConflict();
      return { ...existing, created: false };
    }
    this.commands.set(commandKey, { aggregateId, fingerprint });
    return { aggregateId, fingerprint, created: true };
  }

  private async claimDbCommand(client: PoolClient, scope: string, key: string, aggregateId: string, fingerprint: string) {
    const inserted = await client.query(
      `INSERT INTO post_trade_commands (command_scope,idempotency_key,aggregate_id,payload_fingerprint)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING aggregate_id`,
      [scope, key, aggregateId, fingerprint],
    );
    if (inserted.rows[0]) return { aggregateId, created: true };
    const existing = await client.query<{ aggregate_id: string; payload_fingerprint: string }>(
      'SELECT aggregate_id,payload_fingerprint FROM post_trade_commands WHERE command_scope=$1 AND idempotency_key=$2', [scope, key]);
    const row = existing.rows[0]!;
    if ((row.aggregate_id !== aggregateId && scope !== 'SETTLEMENT_CREATE') || row.payload_fingerprint !== fingerprint) this.idempotencyConflict();
    return { aggregateId: row.aggregate_id, created: false };
  }

  private async repointDbCommand(client: PoolClient, scope: string, key: string, aggregateId: string): Promise<void> {
    await client.query('UPDATE post_trade_commands SET aggregate_id=$3 WHERE command_scope=$1 AND idempotency_key=$2', [scope, key, aggregateId]);
  }

  private assertSameAcknowledgement(bundle: SettlementBundle, dto: AcknowledgeRegistryDto): void {
    if (bundle.registryMessage.registryReference !== dto.registryReference ||
      bundle.registryMessage.acknowledgedQuantity !== dto.acknowledgedQuantity) this.idempotencyConflict();
  }

  private fingerprint(value: object): string { return JSON.stringify(value); }
  private number(value: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error('Database amount exceeds JavaScript safe integer range');
    return parsed;
  }
  private invalidState(subject: string, actual: string, expected: string): never {
    throw new ConflictException({ code: 'SET-INVALID-STATE', message: `${subject} is ${actual}; expected ${expected}` });
  }
  private idempotencyConflict(): never {
    throw new ConflictException({ code: 'SET-IDEMPOTENCY-CONFLICT', message: 'Idempotency key was already used for another command payload or aggregate' });
  }
  private duplicateRegistryReference(): never {
    throw new ConflictException({ code: 'SRUK-REFERENCE-DUPLICATE', message: 'Registry reference was already acknowledged for another transfer' });
  }
}
