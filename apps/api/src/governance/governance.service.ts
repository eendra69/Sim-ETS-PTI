import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { Trade, TriggerEvent } from '../limit-order/limit-order.types';
import { BASELINE_MARKET_RULESET } from '../limit-order/market-ruleset';
import { AdminCommandDto, CreateRulesetDto, UpdateRulesetDto } from './dto/admin-command.dto';
import {
  AuditEvent,
  AuditEventInput,
  GovernedRuleset,
  MarketSession,
  MarketSessionStatus,
  SurveillanceAlert,
  SurveillanceAlertType,
} from './governance.types';

interface RulesetRow extends QueryResultRow {
  ruleset_id: string; series_code: string; compliance_period: number; version: number;
  status: GovernedRuleset['status']; effective_from: Date | null; effective_to: Date | null;
  reference_price: string; minimum_price: string; maximum_price: string; tick_size: string;
  lot_size: string; allowed_limit_tif: Array<'DAY' | 'GTC'>; market_time_in_force: 'IOC';
  market_protection_required: boolean; stop_trigger_basis: 'LTP';
  stop_buy_direction: 'GREATER_THAN_OR_EQUAL'; stop_sell_direction: 'LESS_THAN_OR_EQUAL';
  stop_activation_type: 'MARKET'; stop_reservation_timing: 'SUBMISSION'; market_session_id: string;
  sell_cap_percentage: number; settlement_finality: GovernedRuleset['settlementFinality'];
  surveillance_price_deviation_bps: number; surveillance_volume_threshold: string;
  repeated_cancel_threshold: number;
}

interface SessionRow extends QueryResultRow {
  session_id: string; series_code: string; compliance_period: number; ruleset_id: string;
  status: MarketSessionStatus; opened_at: Date | null; halted_at: Date | null;
  resumed_at: Date | null; closed_at: Date | null; updated_at: Date;
}

interface AuditRow extends QueryResultRow {
  audit_event_id: string; event_sequence: string; event_type: string; entity_type: string;
  entity_id: string; actor_id: string; permission_context: string; before_state: unknown;
  after_state: unknown; correlation_id: string; causation_id: string | null;
  ruleset_id: string | null; occurred_at: Date;
}

interface AlertRow extends QueryResultRow {
  alert_id: string; alert_sequence: string; alert_type: SurveillanceAlertType;
  severity: SurveillanceAlert['severity']; participant_id: string | null; order_id: string | null;
  trade_id: string | null; trigger_event_id: string | null; description: string;
  evidence: Record<string, unknown>; status: SurveillanceAlert['status']; correlation_id: string;
  ruleset_id: string; created_at: Date;
}

interface MemoryCommand { aggregateId: string; fingerprint: string }

@Injectable()
export class GovernanceService implements OnModuleInit, OnModuleDestroy {
  private readonly rulesets = new Map<string, GovernedRuleset>();
  private readonly sessions = new Map<string, MarketSession>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly alerts: SurveillanceAlert[] = [];
  private readonly commands = new Map<string, MemoryCommand>();
  private readonly cancelCounts = new Map<string, number>();
  private readonly pool?: Pool;
  private activeRuleset: GovernedRuleset = { ...BASELINE_MARKET_RULESET };
  private nextAuditSequence = 1;
  private nextAlertSequence = 1;

  constructor() {
    const usePostgres = process.env.NODE_ENV !== 'test' && process.env.PERSISTENCE_MODE === 'postgres';
    if (usePostgres) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    } else {
      this.rulesets.set(this.activeRuleset.rulesetId, { ...this.activeRuleset });
      const now = new Date().toISOString();
      this.sessions.set(this.activeRuleset.marketSessionId, {
        sessionId: this.activeRuleset.marketSessionId,
        seriesCode: this.activeRuleset.seriesCode,
        compliancePeriod: this.activeRuleset.compliancePeriod,
        rulesetId: this.activeRuleset.rulesetId,
        status: 'OPEN',
        openedAt: now,
        updatedAt: now,
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.pool) return;
    const result = await this.pool.query<RulesetRow>(
      `SELECT * FROM market_rulesets WHERE status='ACTIVE'
       AND (effective_from IS NULL OR effective_from<=now())
       AND (effective_to IS NULL OR effective_to>now())
       ORDER BY activated_at DESC NULLS LAST LIMIT 1`,
    );
    if (result.rows[0]) this.activeRuleset = this.mapRuleset(result.rows[0]);
    const sessions = await this.pool.query<SessionRow>('SELECT * FROM market_sessions');
    for (const row of sessions.rows) this.sessions.set(row.session_id, this.mapSession(row));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  getCurrentRuleset(): GovernedRuleset {
    return structuredClone(this.activeRuleset);
  }

  async getActiveRuleset(seriesCode: string, compliancePeriod: number): Promise<GovernedRuleset> {
    if (!this.pool) {
      const ruleset = [...this.rulesets.values()].find(
        (item) => item.status === 'ACTIVE' && item.seriesCode === seriesCode && item.compliancePeriod === compliancePeriod &&
          (!item.effectiveFrom || Date.parse(item.effectiveFrom) <= Date.now()) &&
          (!item.effectiveTo || Date.parse(item.effectiveTo) > Date.now()),
      );
      if (!ruleset) this.unsupportedMarket();
      this.activeRuleset = ruleset;
      return structuredClone(ruleset);
    }
    const result = await this.pool.query<RulesetRow>(
      `SELECT * FROM market_rulesets WHERE series_code=$1 AND compliance_period=$2 AND status='ACTIVE'
       AND (effective_from IS NULL OR effective_from<=now()) AND (effective_to IS NULL OR effective_to>now())`,
      [seriesCode, compliancePeriod],
    );
    if (!result.rows[0]) this.unsupportedMarket();
    this.activeRuleset = this.mapRuleset(result.rows[0]);
    return structuredClone(this.activeRuleset);
  }

  async listRulesets(seriesCode?: string, compliancePeriod?: number): Promise<GovernedRuleset[]> {
    if (!this.pool) return [...this.rulesets.values()]
      .filter((item) => (!seriesCode || item.seriesCode === seriesCode) &&
        (!compliancePeriod || item.compliancePeriod === compliancePeriod))
      .sort((a, b) => b.version - a.version).map((item) => structuredClone(item));
    const result = await this.pool.query<RulesetRow>(
      `SELECT * FROM market_rulesets
       WHERE ($1::text IS NULL OR series_code=$1) AND ($2::integer IS NULL OR compliance_period=$2)
       ORDER BY compliance_period DESC, version DESC`, [seriesCode ?? null, compliancePeriod ?? null],
    );
    return result.rows.map((row) => this.mapRuleset(row));
  }

  async getRuleset(rulesetId: string): Promise<GovernedRuleset> {
    if (!this.pool) {
      const item = this.rulesets.get(rulesetId);
      if (!item) throw new NotFoundException(`Ruleset ${rulesetId} was not found`);
      return structuredClone(item);
    }
    const result = await this.pool.query<RulesetRow>('SELECT * FROM market_rulesets WHERE ruleset_id=$1', [rulesetId]);
    if (!result.rows[0]) throw new NotFoundException(`Ruleset ${rulesetId} was not found`);
    return this.mapRuleset(result.rows[0]);
  }

  async createDraft(dto: CreateRulesetDto): Promise<GovernedRuleset> {
    const ruleset = this.rulesetFromCreate(dto);
    this.validateRuleset(ruleset);
    if (!this.pool) {
      const command = this.claimMemoryCommand('RULESET_CREATE', dto.idempotencyKey, dto.rulesetId, dto);
      if (!command.created) return this.getRuleset(command.aggregateId);
      if (this.rulesets.has(dto.rulesetId) || [...this.rulesets.values()].some(
        (item) => item.seriesCode === dto.seriesCode && item.compliancePeriod === dto.compliancePeriod && item.version === dto.version,
      )) throw new ConflictException({ code: 'RULESET-VERSION-CONFLICT', message: 'Ruleset ID or version already exists' });
      this.rulesets.set(ruleset.rulesetId, ruleset);
      await this.recordAudit(this.adminAudit('RULESET_DRAFT_CREATED', 'RULESET', ruleset.rulesetId, dto, undefined, ruleset));
      return structuredClone(ruleset);
    }
    return this.withTransaction(async (client) => {
      const command = await this.claimDbCommand(client, 'RULESET_CREATE', dto.idempotencyKey, dto.rulesetId, dto);
      if (!command.created) return this.getDbRuleset(client, command.aggregateId);
      await client.query(
        `INSERT INTO market_rulesets (
          ruleset_id,series_code,compliance_period,version,status,effective_from,reference_price,
          minimum_price,maximum_price,tick_size,lot_size,market_session_id,sell_cap_percentage,
          settlement_finality,surveillance_price_deviation_bps,surveillance_volume_threshold,
          repeated_cancel_threshold,created_by
        ) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [ruleset.rulesetId,ruleset.seriesCode,ruleset.compliancePeriod,ruleset.version,
          ruleset.effectiveFrom ?? null,ruleset.referencePrice,ruleset.minimumPrice,ruleset.maximumPrice,
          ruleset.tickSize,ruleset.lotSize,ruleset.marketSessionId,ruleset.sellCapPercentage,
          ruleset.settlementFinality,ruleset.surveillancePriceDeviationBps,ruleset.surveillanceVolumeThreshold,
          ruleset.repeatedCancelThreshold,dto.actorId],
      );
      await this.insertAudit(client, this.adminAudit('RULESET_DRAFT_CREATED', 'RULESET', ruleset.rulesetId, dto, undefined, ruleset));
      return this.getDbRuleset(client, ruleset.rulesetId);
    });
  }

  async updateDraft(rulesetId: string, dto: UpdateRulesetDto): Promise<GovernedRuleset> {
    return this.mutateRuleset(rulesetId, 'RULESET_UPDATE', dto, ['DRAFT'], 'RULESET_DRAFT_UPDATED',
      (ruleset) => ({ ...ruleset, referencePrice: dto.referencePrice, minimumPrice: dto.minimumPrice,
        maximumPrice: dto.maximumPrice, tickSize: dto.tickSize, lotSize: dto.lotSize,
        sellCapPercentage: dto.sellCapPercentage, settlementFinality: dto.settlementFinality,
        surveillancePriceDeviationBps: dto.surveillancePriceDeviationBps,
        surveillanceVolumeThreshold: dto.surveillanceVolumeThreshold,
        repeatedCancelThreshold: dto.repeatedCancelThreshold }),
    );
  }

  async approve(rulesetId: string, dto: AdminCommandDto): Promise<GovernedRuleset> {
    return this.mutateRuleset(rulesetId, 'RULESET_APPROVE', dto, ['DRAFT'], 'RULESET_APPROVED',
      (ruleset) => ({ ...ruleset, status: 'APPROVED' }),
    );
  }

  async activate(rulesetId: string, dto: AdminCommandDto): Promise<GovernedRuleset> {
    const correlationId = randomUUID();
    if (!this.pool) {
      const command = this.claimMemoryCommand('RULESET_ACTIVATE', dto.idempotencyKey, rulesetId, dto);
      if (!command.created) return this.getRuleset(rulesetId);
      const target = this.rulesets.get(rulesetId);
      if (!target) throw new NotFoundException(`Ruleset ${rulesetId} was not found`);
      if (target.status === 'ACTIVE') return structuredClone(target);
      if (target.status !== 'APPROVED') this.invalidRulesetState(target.status, 'APPROVED');
      if (target.effectiveFrom && Date.parse(target.effectiveFrom) > Date.now()) {
        throw new ConflictException({ code: 'RULESET-NOT-EFFECTIVE', message: 'Ruleset effectiveFrom is still in the future' });
      }
      const now = new Date().toISOString();
      for (const item of this.rulesets.values()) {
        if (item.status === 'ACTIVE' && item.seriesCode === target.seriesCode && item.compliancePeriod === target.compliancePeriod) {
          item.status = 'RETIRED'; item.effectiveTo = now;
        }
      }
      const before = structuredClone(target);
      target.status = 'ACTIVE'; target.effectiveFrom ??= now;
      this.activeRuleset = target;
      const currentSession = this.sessions.get(target.marketSessionId);
      this.sessions.set(target.marketSessionId, { ...currentSession,
        sessionId: target.marketSessionId, seriesCode: target.seriesCode,
        compliancePeriod: target.compliancePeriod, rulesetId: target.rulesetId,
        status: currentSession?.status ?? 'CLOSED', updatedAt: now });
      await this.recordAudit({ ...this.adminAudit('RULESET_ACTIVATED','RULESET',rulesetId,dto,before,target), correlationId });
      return structuredClone(target);
    }
    return this.withTransaction(async (client) => {
      const command = await this.claimDbCommand(client, 'RULESET_ACTIVATE', dto.idempotencyKey, rulesetId, dto);
      if (!command.created) return this.getDbRuleset(client, rulesetId);
      const target = await this.getDbRuleset(client, rulesetId, true);
      if (target.status === 'ACTIVE') return target;
      if (target.status !== 'APPROVED') this.invalidRulesetState(target.status, 'APPROVED');
      if (target.effectiveFrom && Date.parse(target.effectiveFrom) > Date.now()) {
        throw new ConflictException({ code: 'RULESET-NOT-EFFECTIVE', message: 'Ruleset effectiveFrom is still in the future' });
      }
      await client.query(
        `UPDATE market_rulesets SET status='RETIRED',effective_to=now(),updated_at=now()
         WHERE series_code=$1 AND compliance_period=$2 AND status='ACTIVE'`,
        [target.seriesCode,target.compliancePeriod],
      );
      await client.query(
        `UPDATE market_rulesets SET status='ACTIVE',effective_from=COALESCE(effective_from,now()),
         activated_by=$2,activated_at=now(),updated_at=now() WHERE ruleset_id=$1`, [rulesetId,dto.actorId],
      );
      await client.query(
        `INSERT INTO market_sessions (session_id,series_code,compliance_period,ruleset_id,status,updated_at)
         VALUES ($1,$2,$3,$4,'CLOSED',now())
         ON CONFLICT (session_id) DO UPDATE SET ruleset_id=EXCLUDED.ruleset_id,updated_at=now()`,
        [target.marketSessionId,target.seriesCode,target.compliancePeriod,target.rulesetId],
      );
      const after = await this.getDbRuleset(client, rulesetId);
      await this.insertAudit(client, { ...this.adminAudit('RULESET_ACTIVATED','RULESET',rulesetId,dto,target,after), correlationId });
      this.activeRuleset = after;
      this.sessions.set(target.marketSessionId, await this.getDbSession(client, target.marketSessionId));
      return after;
    });
  }

  async getSession(sessionId: string): Promise<MarketSession> {
    if (!this.pool) {
      const session = this.sessions.get(sessionId);
      if (!session) throw new NotFoundException(`Market session ${sessionId} was not found`);
      return { ...session };
    }
    const result = await this.pool.query<SessionRow>('SELECT * FROM market_sessions WHERE session_id=$1', [sessionId]);
    if (!result.rows[0]) throw new NotFoundException(`Market session ${sessionId} was not found`);
    const session = this.mapSession(result.rows[0]);
    this.sessions.set(sessionId, session);
    return session;
  }

  getCachedSession(sessionId = this.activeRuleset.marketSessionId): MarketSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundException(`Market session ${sessionId} was not found`);
    return { ...session };
  }

  assertOrderEntryOpen(seriesCode: string, compliancePeriod: number): void {
    const ruleset = this.activeRuleset;
    if (ruleset.seriesCode !== seriesCode || ruleset.compliancePeriod !== compliancePeriod) this.unsupportedMarket();
    const session = this.getCachedSession(ruleset.marketSessionId);
    if (session.status !== 'OPEN') throw new ConflictException({
      code: `MARKET-${session.status}`,
      message: `Market session ${session.sessionId} is ${session.status}; new orders are blocked`,
    });
  }

  isMatchingOpen(seriesCode: string, compliancePeriod: number): boolean {
    const ruleset = this.activeRuleset;
    if (ruleset.seriesCode !== seriesCode || ruleset.compliancePeriod !== compliancePeriod) return false;
    return this.sessions.get(ruleset.marketSessionId)?.status === 'OPEN';
  }

  async transitionSession(sessionId: string, action: 'OPEN'|'HALT'|'RESUME'|'CLOSE', dto: AdminCommandDto): Promise<MarketSession> {
    const targetStatus: MarketSessionStatus = action === 'HALT' ? 'HALTED' : action === 'CLOSE' ? 'CLOSED' : 'OPEN';
    const allowed: Record<typeof action, MarketSessionStatus[]> = {
      OPEN: ['CLOSED'], HALT: ['OPEN'], RESUME: ['HALTED'], CLOSE: ['OPEN','HALTED'],
    };
    const scope = `SESSION_${action}`;
    if (!this.pool) {
      const command = this.claimMemoryCommand(scope,dto.idempotencyKey,sessionId,dto);
      if (!command.created) return this.getSession(sessionId);
      const session = this.sessions.get(sessionId);
      if (!session) throw new NotFoundException(`Market session ${sessionId} was not found`);
      if (session.status === targetStatus) return { ...session };
      if (!allowed[action].includes(session.status)) this.invalidSessionState(session.status, allowed[action]);
      const before = { ...session }; const now = new Date().toISOString(); session.status = targetStatus;
      if (action === 'OPEN') session.openedAt = now;
      if (action === 'HALT') session.haltedAt = now;
      if (action === 'RESUME') session.resumedAt = now;
      if (action === 'CLOSE') session.closedAt = now;
      session.updatedAt = now;
      await this.recordAudit(this.adminAudit(`MARKET_SESSION_${action}`, 'MARKET_SESSION', sessionId, dto, before, session));
      return { ...session };
    }
    return this.withTransaction(async (client) => {
      const command = await this.claimDbCommand(client,scope,dto.idempotencyKey,sessionId,dto);
      if (!command.created) return this.getDbSession(client,sessionId);
      const before = await this.getDbSession(client,sessionId,true);
      if (before.status === targetStatus) return before;
      if (!allowed[action].includes(before.status)) this.invalidSessionState(before.status,allowed[action]);
      const timestampColumn = action === 'OPEN' ? 'opened_at' : action === 'HALT' ? 'halted_at' : action === 'RESUME' ? 'resumed_at' : 'closed_at';
      await client.query(`UPDATE market_sessions SET status=$2,${timestampColumn}=now(),updated_at=now() WHERE session_id=$1`, [sessionId,targetStatus]);
      const after = await this.getDbSession(client,sessionId);
      await this.insertAudit(client,this.adminAudit(`MARKET_SESSION_${action}`,'MARKET_SESSION',sessionId,dto,before,after));
      this.sessions.set(sessionId,after);
      return after;
    });
  }

  async recordAudit(input: AuditEventInput, transaction?: PoolClient): Promise<AuditEvent> {
    if (!this.pool) {
      const event: AuditEvent = { auditEventId: randomUUID(), eventSequence: this.nextAuditSequence++, ...input,
        occurredAt: new Date().toISOString() };
      this.auditEvents.push(event); return structuredClone(event);
    }
    return this.insertAudit(transaction ?? this.pool,input);
  }

  async listAuditEvents(correlationId?: string, entityType?: string, limit=100): Promise<AuditEvent[]> {
    if (!this.pool) return this.auditEvents
      .filter((item) => (!correlationId || item.correlationId === correlationId) && (!entityType || item.entityType === entityType))
      .slice(-limit).map((item) => structuredClone(item));
    const result = await this.pool.query<AuditRow>(
      `SELECT * FROM audit_events WHERE ($1::uuid IS NULL OR correlation_id=$1)
       AND ($2::text IS NULL OR entity_type=$2) ORDER BY event_sequence DESC LIMIT $3`,
      [correlationId ?? null,entityType ?? null,limit],
    );
    return result.rows.reverse().map((row) => this.mapAudit(row));
  }

  async inspectTrade(trade: Trade, ruleset = this.activeRuleset): Promise<void> {
    const deviationBps = Math.abs(trade.price-ruleset.referencePrice)*10_000/ruleset.referencePrice;
    if (deviationBps >= ruleset.surveillancePriceDeviationBps) await this.createAlert('UNUSUAL_PRICE','WARNING',
      `Trade price deviates ${Math.round(deviationBps)} bps from reference`, { price: trade.price, referencePrice: ruleset.referencePrice, deviationBps },
      trade.correlationId, trade.rulesetId, { tradeId: trade.tradeId });
    if (trade.quantity >= ruleset.surveillanceVolumeThreshold) await this.createAlert('UNUSUAL_VOLUME','WARNING',
      `Trade quantity ${trade.quantity} reaches the surveillance threshold`, { quantity: trade.quantity, threshold: ruleset.surveillanceVolumeThreshold },
      trade.correlationId, trade.rulesetId, { tradeId: trade.tradeId });
  }

  async inspectSelfMatch(participantId: string, orderId: string, opposingOrderId: string, correlationId: string, rulesetId: string): Promise<void> {
    await this.createAlert('SELF_MATCH','CRITICAL','Potential self-match was prevented', { opposingOrderId },
      correlationId,rulesetId,{ participantId,orderId });
  }

  async inspectCancel(participantId: string, orderId: string, correlationId: string, rulesetId: string): Promise<void> {
    const key = `${participantId}:${rulesetId}`;
    let count: number;
    if (!this.pool) {
      count = (this.cancelCounts.get(key) ?? 0)+1; this.cancelCounts.set(key,count);
    } else {
      const result = await this.pool.query<{ count: string }>(
        `SELECT count(*) FROM audit_events WHERE event_type='ORDER_CANCELLED' AND actor_id=$1 AND ruleset_id=$2`,
        [participantId,rulesetId],
      );
      count = Number(result.rows[0]!.count)+1;
    }
    if (count === this.activeRuleset.repeatedCancelThreshold) await this.createAlert('REPEATED_CANCEL','WARNING',
      `Participant reached ${count} cancellations`, { count, threshold: this.activeRuleset.repeatedCancelThreshold },
      correlationId,rulesetId,{ participantId,orderId });
  }

  async inspectTrigger(event: TriggerEvent, stopPrice: number, rulesetId: string): Promise<void> {
    const deviationBps = Math.abs(event.observedLtp-stopPrice)*10_000/this.activeRuleset.referencePrice;
    if (deviationBps >= this.activeRuleset.surveillancePriceDeviationBps) await this.createAlert('TRIGGER_ANOMALY','WARNING',
      'STOP activation occurred after a material price gap', { observedLtp:event.observedLtp,stopPrice,deviationBps },
      event.correlationId,rulesetId,{ triggerEventId:event.triggerEventId });
  }

  async listAlerts(limit=100): Promise<SurveillanceAlert[]> {
    if (!this.pool) return this.alerts.slice(-limit).map((item) => structuredClone(item));
    const result = await this.pool.query<AlertRow>('SELECT * FROM surveillance_alerts ORDER BY alert_sequence DESC LIMIT $1',[limit]);
    return result.rows.reverse().map((row) => this.mapAlert(row));
  }

  private async createAlert(type: SurveillanceAlertType, severity: SurveillanceAlert['severity'], description: string,
    evidence: Record<string,unknown>, correlationId: string, rulesetId: string,
    refs: {participantId?:string;orderId?:string;tradeId?:string;triggerEventId?:string}): Promise<void> {
    if (!this.pool) {
      this.alerts.push({ alertId:randomUUID(),alertSequence:this.nextAlertSequence++,alertType:type,severity,
        ...refs,description,evidence,status:'OPEN',correlationId,rulesetId,createdAt:new Date().toISOString() }); return;
    }
    await this.pool.query(
      `INSERT INTO surveillance_alerts (alert_type,severity,participant_id,order_id,trade_id,trigger_event_id,
       description,evidence,correlation_id,ruleset_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [type,severity,refs.participantId??null,refs.orderId??null,refs.tradeId??null,refs.triggerEventId??null,
        description,JSON.stringify(evidence),correlationId,rulesetId],
    );
  }

  private async mutateRuleset(rulesetId:string,scope:string,dto:AdminCommandDto,allowed:GovernedRuleset['status'][],eventType:string,
    mutation:(ruleset:GovernedRuleset)=>GovernedRuleset):Promise<GovernedRuleset> {
    if (!this.pool) {
      const command=this.claimMemoryCommand(scope,dto.idempotencyKey,rulesetId,dto); if(!command.created)return this.getRuleset(rulesetId);
      const current=this.rulesets.get(rulesetId); if(!current)throw new NotFoundException(`Ruleset ${rulesetId} was not found`);
      if(!allowed.includes(current.status))this.invalidRulesetState(current.status,allowed.join(' or '));
      const before=structuredClone(current); const after=mutation(structuredClone(current)); this.validateRuleset(after);
      this.rulesets.set(rulesetId,after); await this.recordAudit(this.adminAudit(eventType,'RULESET',rulesetId,dto,before,after)); return structuredClone(after);
    }
    return this.withTransaction(async(client)=>{
      const command=await this.claimDbCommand(client,scope,dto.idempotencyKey,rulesetId,dto); if(!command.created)return this.getDbRuleset(client,rulesetId);
      const before=await this.getDbRuleset(client,rulesetId,true); if(!allowed.includes(before.status))this.invalidRulesetState(before.status,allowed.join(' or '));
      const after=mutation(structuredClone(before)); this.validateRuleset(after);
      await client.query(`UPDATE market_rulesets SET reference_price=$2,minimum_price=$3,maximum_price=$4,
        tick_size=$5,lot_size=$6,sell_cap_percentage=$7,settlement_finality=$8,
        surveillance_price_deviation_bps=$9,surveillance_volume_threshold=$10,repeated_cancel_threshold=$11,
        status=$12,approved_by=CASE WHEN $12='APPROVED' THEN $13 ELSE approved_by END,
        approved_at=CASE WHEN $12='APPROVED' THEN now() ELSE approved_at END,updated_at=now() WHERE ruleset_id=$1`,
        [rulesetId,after.referencePrice,after.minimumPrice,after.maximumPrice,after.tickSize,after.lotSize,
          after.sellCapPercentage,after.settlementFinality,after.surveillancePriceDeviationBps,
          after.surveillanceVolumeThreshold,after.repeatedCancelThreshold,after.status,dto.actorId]);
      const persisted=await this.getDbRuleset(client,rulesetId); await this.insertAudit(client,this.adminAudit(eventType,'RULESET',rulesetId,dto,before,persisted)); return persisted;
    });
  }

  private rulesetFromCreate(dto:CreateRulesetDto):GovernedRuleset {
    return { rulesetId:dto.rulesetId,seriesCode:dto.seriesCode,compliancePeriod:dto.compliancePeriod,
      version:dto.version,status:'DRAFT',...(dto.effectiveFrom?{effectiveFrom:dto.effectiveFrom}:{}),
      referencePrice:dto.referencePrice,minimumPrice:dto.minimumPrice,maximumPrice:dto.maximumPrice,
      tickSize:dto.tickSize,lotSize:dto.lotSize,currency:'IDR',allowedLimitTimeInForce:['DAY','GTC'],
      marketTimeInForce:'IOC',marketProtectionRequired:true,stopTriggerBasis:'LTP',
      stopBuyDirection:'GREATER_THAN_OR_EQUAL',stopSellDirection:'LESS_THAN_OR_EQUAL',
      stopActivationType:'MARKET',stopReservationTiming:'SUBMISSION',marketSessionId:dto.marketSessionId,
      sellCapPercentage:dto.sellCapPercentage??100,settlementFinality:dto.settlementFinality??'SRUK_ACK_RECONCILED',
      surveillancePriceDeviationBps:dto.surveillancePriceDeviationBps??2000,
      surveillanceVolumeThreshold:dto.surveillanceVolumeThreshold??25000,
      repeatedCancelThreshold:dto.repeatedCancelThreshold??3 };
  }

  private validateRuleset(ruleset:GovernedRuleset):void {
    if(ruleset.minimumPrice>ruleset.referencePrice||ruleset.referencePrice>ruleset.maximumPrice)
      throw new BadRequestException({code:'RULESET-INVALID-BAND',message:'Reference price must be inside the price band'});
    if(ruleset.minimumPrice%ruleset.tickSize!==0||ruleset.maximumPrice%ruleset.tickSize!==0||ruleset.referencePrice%ruleset.tickSize!==0)
      throw new BadRequestException({code:'RULESET-INVALID-TICK',message:'Band and reference prices must align with tick size'});
  }

  private adminAudit(eventType:string,entityType:string,entityId:string,dto:AdminCommandDto,beforeState?:unknown,afterState?:unknown):AuditEventInput {
    return {eventType,entityType,entityId,actorId:dto.actorId,permissionContext:dto.permissionContext,
      ...(beforeState!==undefined?{beforeState}:{}),...(afterState!==undefined?{afterState}:{}),
      correlationId:randomUUID(),...(dto.causationId?{causationId:dto.causationId}:{})};
  }

  private async insertAudit(queryable:Pick<Pool,'query'>|PoolClient,input:AuditEventInput):Promise<AuditEvent> {
    const result=await queryable.query<AuditRow>(`INSERT INTO audit_events (event_type,entity_type,entity_id,
      actor_id,permission_context,before_state,after_state,correlation_id,causation_id,ruleset_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[input.eventType,input.entityType,input.entityId,
      input.actorId,input.permissionContext,input.beforeState===undefined?null:JSON.stringify(input.beforeState),
      input.afterState===undefined?null:JSON.stringify(input.afterState),input.correlationId,input.causationId??null,input.rulesetId??null]);
    return this.mapAudit(result.rows[0]!);
  }

  private async getDbRuleset(queryable:Pick<Pool,'query'>|PoolClient,id:string,lock=false):Promise<GovernedRuleset>{
    const result=await queryable.query<RulesetRow>(`SELECT * FROM market_rulesets WHERE ruleset_id=$1${lock?' FOR UPDATE':''}`,[id]);
    if(!result.rows[0])throw new NotFoundException(`Ruleset ${id} was not found`); return this.mapRuleset(result.rows[0]);
  }
  private async getDbSession(queryable:Pick<Pool,'query'>|PoolClient,id:string,lock=false):Promise<MarketSession>{
    const result=await queryable.query<SessionRow>(`SELECT * FROM market_sessions WHERE session_id=$1${lock?' FOR UPDATE':''}`,[id]);
    if(!result.rows[0])throw new NotFoundException(`Market session ${id} was not found`); return this.mapSession(result.rows[0]);
  }
  private mapRuleset(r:RulesetRow):GovernedRuleset{return{rulesetId:r.ruleset_id,seriesCode:r.series_code,
    compliancePeriod:r.compliance_period,version:r.version,status:r.status,
    ...(r.effective_from?{effectiveFrom:r.effective_from.toISOString()}:{}),...(r.effective_to?{effectiveTo:r.effective_to.toISOString()}:{}),
    referencePrice:this.number(r.reference_price),minimumPrice:this.number(r.minimum_price),maximumPrice:this.number(r.maximum_price),
    tickSize:this.number(r.tick_size),lotSize:this.number(r.lot_size),currency:'IDR',allowedLimitTimeInForce:r.allowed_limit_tif,
    marketTimeInForce:r.market_time_in_force,marketProtectionRequired:true,
    stopTriggerBasis:r.stop_trigger_basis,stopBuyDirection:r.stop_buy_direction,stopSellDirection:r.stop_sell_direction,
    stopActivationType:r.stop_activation_type,stopReservationTiming:r.stop_reservation_timing,marketSessionId:r.market_session_id,
    sellCapPercentage:r.sell_cap_percentage,settlementFinality:r.settlement_finality,
    surveillancePriceDeviationBps:r.surveillance_price_deviation_bps,
    surveillanceVolumeThreshold:this.number(r.surveillance_volume_threshold),repeatedCancelThreshold:r.repeated_cancel_threshold};}
  private mapSession(r:SessionRow):MarketSession{return{sessionId:r.session_id,seriesCode:r.series_code,
    compliancePeriod:r.compliance_period,rulesetId:r.ruleset_id,status:r.status,
    ...(r.opened_at?{openedAt:r.opened_at.toISOString()}:{}),...(r.halted_at?{haltedAt:r.halted_at.toISOString()}:{}),
    ...(r.resumed_at?{resumedAt:r.resumed_at.toISOString()}:{}),...(r.closed_at?{closedAt:r.closed_at.toISOString()}:{}),updatedAt:r.updated_at.toISOString()};}
  private mapAudit(r:AuditRow):AuditEvent{return{auditEventId:r.audit_event_id,eventSequence:this.number(r.event_sequence),
    eventType:r.event_type,entityType:r.entity_type,entityId:r.entity_id,actorId:r.actor_id,
    permissionContext:r.permission_context,...(r.before_state!==null?{beforeState:r.before_state}:{}),
    ...(r.after_state!==null?{afterState:r.after_state}:{}),correlationId:r.correlation_id,
    ...(r.causation_id?{causationId:r.causation_id}:{}),...(r.ruleset_id?{rulesetId:r.ruleset_id}:{}),occurredAt:r.occurred_at.toISOString()};}
  private mapAlert(r:AlertRow):SurveillanceAlert{return{alertId:r.alert_id,alertSequence:this.number(r.alert_sequence),
    alertType:r.alert_type,severity:r.severity,...(r.participant_id?{participantId:r.participant_id}:{}),
    ...(r.order_id?{orderId:r.order_id}:{}),...(r.trade_id?{tradeId:r.trade_id}:{}),
    ...(r.trigger_event_id?{triggerEventId:r.trigger_event_id}:{}),description:r.description,evidence:r.evidence,
    status:r.status,correlationId:r.correlation_id,rulesetId:r.ruleset_id,createdAt:r.created_at.toISOString()};}

  private claimMemoryCommand(scope:string,key:string,aggregateId:string,payload:unknown){const k=`${scope}:${key}`;const fingerprint=JSON.stringify(payload);const existing=this.commands.get(k);if(existing){if(existing.aggregateId!==aggregateId||existing.fingerprint!==fingerprint)this.idempotencyConflict();return{...existing,created:false};}this.commands.set(k,{aggregateId,fingerprint});return{aggregateId,created:true};}
  private async claimDbCommand(client:PoolClient,scope:string,key:string,aggregateId:string,payload:unknown){const fingerprint=JSON.stringify(payload);const inserted=await client.query(`INSERT INTO governance_commands(command_scope,idempotency_key,aggregate_id,payload_fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING aggregate_id`,[scope,key,aggregateId,fingerprint]);if(inserted.rows[0])return{aggregateId,created:true};const existing=await client.query<{aggregate_id:string;payload_fingerprint:string}>('SELECT aggregate_id,payload_fingerprint FROM governance_commands WHERE command_scope=$1 AND idempotency_key=$2',[scope,key]);const row=existing.rows[0]!;if(row.aggregate_id!==aggregateId||row.payload_fingerprint!==fingerprint)this.idempotencyConflict();return{aggregateId,created:false};}
  private async withTransaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await this.pool!.connect();try{await client.query('BEGIN');const result=await operation(client);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
  private number(value:string):number{const result=Number(value);if(!Number.isSafeInteger(result))throw new Error('Database value exceeds JavaScript safe integer range');return result;}
  private unsupportedMarket():never{throw new BadRequestException({code:'ORD-UNSUPPORTED-MARKET',message:'No active ruleset exists for the requested market'});}
  private invalidRulesetState(actual:string,expected:string):never{throw new ConflictException({code:'RULESET-IMMUTABLE',message:`Ruleset is ${actual}; expected ${expected}. Active rulesets cannot be edited in place.`});}
  private invalidSessionState(actual:string,expected:string[]):never{throw new ConflictException({code:'SESSION-INVALID-STATE',message:`Session is ${actual}; expected ${expected.join(' or ')}`});}
  private idempotencyConflict():never{throw new ConflictException({code:'GOV-IDEMPOTENCY-CONFLICT',message:'Idempotency key was reused with another payload or aggregate'});}
}
