import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { KeyedMutex } from '../common/keyed-mutex';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  LimitOrder,
  LimitOrderStatus,
  Order,
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
  ExecutableOrderType,
  StopOrder,
  StopOrderStatus,
  Trade,
  TriggerBookSnapshot,
  TriggerEvent,
} from './limit-order.types';
import { BASELINE_MARKET_RULESET, validateAgainstRuleset } from './market-ruleset';
import { isActive, planMatches } from './matching-engine';

interface LimitOrderRow extends QueryResultRow {
  order_id: string;
  participant_id: string;
  client_order_id: string;
  series_code: string;
  compliance_period: number;
  side: OrderSide;
  order_type: ExecutableOrderType;
  ruleset_id: string;
  quantity: string;
  remaining_quantity: string;
  limit_price: string | null;
  protection_price: string | null;
  time_in_force: 'DAY' | 'GTC' | 'IOC';
  status: LimitOrderStatus;
  reservation_id: string;
  priority_sequence: string;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  parent_stop_order_id: string | null;
}

interface StopOrderRow extends QueryResultRow {
  stop_order_id: string;
  participant_id: string;
  client_order_id: string;
  series_code: string;
  compliance_period: number;
  side: OrderSide;
  ruleset_id: string;
  quantity: string;
  remaining_quantity: string;
  stop_price: string;
  protection_price: string;
  trigger_basis: 'LTP';
  activation_type: 'MARKET';
  time_in_force: 'DAY' | 'GTC';
  status: StopOrderStatus;
  reservation_id: string;
  priority_sequence: string;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  triggered_at?: Date | null;
  activated_order_id?: string | null;
}

interface TriggerEventRow extends QueryResultRow {
  trigger_event_id: string;
  stop_order_id: string;
  source_trade_id: string;
  observed_ltp: string;
  trigger_basis: 'LTP';
  activated_order_id: string;
  correlation_id: string;
  triggered_at: Date;
}

interface MatchExecution {
  order: LimitOrder;
  generatedTrades: Trade[];
}

interface TriggerActivation {
  event: TriggerEvent;
  order: LimitOrder;
}

interface TradeRow extends QueryResultRow {
  trade_id: string;
  match_event_id: string;
  buyer_order_id: string;
  seller_order_id: string;
  buyer_participant_id: string;
  seller_participant_id: string;
  series_code: string;
  compliance_period: number;
  quantity: string;
  price: string;
  notional: string;
  ruleset_id: string;
  status: 'EXECUTED';
  trade_sequence: string;
  executed_at: Date;
}

@Injectable()
export class LimitOrderService implements OnModuleDestroy {
  private readonly orders = new Map<string, LimitOrder>();
  private readonly stopOrders = new Map<string, StopOrder>();
  private readonly triggerEvents = new Map<string, TriggerEvent>();
  private readonly trades = new Map<string, Trade>();
  private readonly mutex = new KeyedMutex();
  private readonly pool?: Pool;
  private nextPrioritySequence = 1;
  private nextTradeSequence = 1;

  constructor(private readonly positionBalanceService: PositionBalanceService) {
    const usePostgres =
      process.env.NODE_ENV !== 'test' && process.env.PERSISTENCE_MODE === 'postgres';
    if (usePostgres) {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
      }
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  getRuleset() {
    return BASELINE_MARKET_RULESET;
  }

  async submit(dto: CreateOrderDto): Promise<Order> {
    return this.mutex.runExclusive(
      `client:${dto.participantId}:${dto.clientOrderId}`,
      async () => {
        const existing = await this.findAnyByClientOrderId(dto.participantId, dto.clientOrderId);
        if (existing) {
          this.assertSamePayload(existing, dto);
          return existing.orderType !== 'STOP' && isActive(existing)
            ? this.executeMatches(existing.orderId)
            : existing;
        }

        const reservationPrice = this.validateOrderCommand(dto);
        validateAgainstRuleset(
          dto.seriesCode,
          dto.compliancePeriod,
          dto.quantity,
          reservationPrice,
        );

        const maximumNotional = dto.quantity * reservationPrice;
        if (!Number.isSafeInteger(maximumNotional)) {
          throw new BadRequestException({
            code: 'ORD-NOTIONAL-OVERFLOW',
            message: 'Order notional exceeds the supported safe integer range',
          });
        }

        const orderReference = `${dto.orderType}:${dto.clientOrderId}`;
        const reservation =
          dto.side === 'SELL'
            ? await this.positionBalanceService.reserveSell({
                participantId: dto.participantId,
                seriesCode: dto.seriesCode,
                compliancePeriod: dto.compliancePeriod,
                quantity: dto.quantity,
                orderReference,
              })
            : await this.positionBalanceService.reserveBuy({
                participantId: dto.participantId,
                seriesCode: dto.seriesCode,
                compliancePeriod: dto.compliancePeriod,
                quantity: dto.quantity,
                maximumNotional,
                feeBuffer: 0,
                orderReference,
              });

        let inserted: LimitOrder;
        try {
          if (dto.orderType === 'STOP') {
            return await this.insertStopOrder(dto, reservation.reservationId);
          }
          inserted = await this.insertOrder(dto, reservation.reservationId);
        } catch (error) {
          const concurrentlyCreated = await this.findAnyByClientOrderId(
            dto.participantId,
            dto.clientOrderId,
          );
          if (concurrentlyCreated) {
            try {
              this.assertSamePayload(concurrentlyCreated, dto);
              return concurrentlyCreated;
            } finally {
              if (concurrentlyCreated.reservationId !== reservation.reservationId) {
                await this.positionBalanceService.releaseReservation(reservation.reservationId);
              }
            }
          }
          await this.positionBalanceService.releaseReservation(reservation.reservationId);
          throw error;
        }
        return this.executeMatches(inserted.orderId);
      },
    );
  }

  async getOrder(orderId: string): Promise<Order> {
    const stop = await this.findStopOrderById(orderId);
    if (stop) return stop;
    return this.getExecutableOrder(orderId);
  }

  private async getExecutableOrder(orderId: string): Promise<LimitOrder> {
    if (!this.pool) {
      const order = this.orders.get(orderId);
      if (!order) throw new NotFoundException(`Order ${orderId} was not found`);
      return { ...order };
    }

    const result = await this.pool.query<LimitOrderRow>(
      'SELECT * FROM limit_orders WHERE order_id = $1',
      [orderId],
    );
    if (!result.rows[0]) throw new NotFoundException(`Order ${orderId} was not found`);
    return this.mapOrder(result.rows[0]);
  }

  async listOrders(seriesCode: string, compliancePeriod: number): Promise<Order[]> {
    const stopOrders = await this.listStopOrders(seriesCode, compliancePeriod, false);
    if (!this.pool) {
      return [...this.orders.values(), ...stopOrders]
        .filter(
          (order) =>
            order.seriesCode === seriesCode && order.compliancePeriod === compliancePeriod,
        )
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((order) => ({ ...order }));
    }
    const result = await this.pool.query<LimitOrderRow>(
      `SELECT * FROM limit_orders
       WHERE series_code = $1 AND compliance_period = $2
       ORDER BY priority_sequence`,
      [seriesCode, compliancePeriod],
    );
    return [...result.rows.map((row) => this.mapOrder(row)), ...stopOrders].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  async listTrades(seriesCode: string, compliancePeriod: number): Promise<Trade[]> {
    if (!this.pool) {
      return [...this.trades.values()]
        .filter(
          (trade) =>
            trade.seriesCode === seriesCode && trade.compliancePeriod === compliancePeriod,
        )
        .sort((left, right) => left.tradeSequence - right.tradeSequence)
        .map((trade) => ({ ...trade }));
    }
    const result = await this.pool.query<TradeRow>(
      `SELECT * FROM trades
       WHERE series_code = $1 AND compliance_period = $2
       ORDER BY trade_sequence`,
      [seriesCode, compliancePeriod],
    );
    return result.rows.map((row) => this.mapTrade(row));
  }

  async getTrade(tradeId: string): Promise<Trade> {
    if (!this.pool) {
      const trade = this.trades.get(tradeId);
      if (!trade) throw new NotFoundException(`Trade ${tradeId} was not found`);
      return { ...trade };
    }
    const result = await this.pool.query<TradeRow>('SELECT * FROM trades WHERE trade_id = $1', [
      tradeId,
    ]);
    if (!result.rows[0]) throw new NotFoundException(`Trade ${tradeId} was not found`);
    return this.mapTrade(result.rows[0]);
  }

  async executeMatches(orderId: string): Promise<LimitOrder> {
    const execution = await this.executeMatchesOnce(orderId);
    await this.processTriggerQueue(execution.generatedTrades);
    return execution.order;
  }

  private async executeMatchesOnce(orderId: string): Promise<MatchExecution> {
    const order = await this.getExecutableOrder(orderId);
    if (!isActive(order)) return { order, generatedTrades: [] };
    const marketKey = `market:${order.seriesCode}:${order.compliancePeriod}`;
    return this.mutex.runExclusive(marketKey, () =>
      this.pool ? this.executeDbMatches(orderId, marketKey) : this.executeMemoryMatches(orderId),
    );
  }

  async cancel(orderId: string): Promise<Order> {
    const stop = await this.findStopOrderById(orderId);
    if (stop) return this.closeStopOrder(stop, 'CANCELLED');
    return this.closeOrder(orderId, 'CANCELLED');
  }

  async expireDayOrders(seriesCode: string, compliancePeriod: number): Promise<Order[]> {
    const candidates = (await this.listOpenOrders(seriesCode, compliancePeriod)).filter(
      (order) => order.timeInForce === 'DAY',
    );
    const stopCandidates = (await this.listStopOrders(seriesCode, compliancePeriod, true)).filter(
      (order) => order.timeInForce === 'DAY',
    );
    const expired: Order[] = [];
    for (const order of candidates) {
      expired.push(await this.closeOrder(order.orderId, 'EXPIRED'));
    }
    for (const order of stopCandidates) {
      expired.push(await this.closeStopOrder(order, 'EXPIRED'));
    }
    return expired;
  }

  async getOrderBook(
    seriesCode: string,
    compliancePeriod: number,
  ): Promise<OrderBookSnapshot> {
    validateAgainstRuleset(seriesCode, compliancePeriod, 1, BASELINE_MARKET_RULESET.minimumPrice);
    const open = await this.listOpenOrders(seriesCode, compliancePeriod);
    const bids = open
      .filter((order) => order.side === 'BUY')
      .sort(
        (left, right) =>
          right.limitPrice! - left.limitPrice! || left.prioritySequence - right.prioritySequence,
      );
    const asks = open
      .filter((order) => order.side === 'SELL')
      .sort(
        (left, right) =>
          left.limitPrice! - right.limitPrice! || left.prioritySequence - right.prioritySequence,
      );

    return {
      seriesCode,
      compliancePeriod,
      bids: this.aggregateLevels(bids),
      asks: this.aggregateLevels(asks),
      orders: { bids, asks },
      generatedAt: new Date().toISOString(),
    };
  }

  async getTriggerBook(
    seriesCode: string,
    compliancePeriod: number,
  ): Promise<TriggerBookSnapshot> {
    validateAgainstRuleset(seriesCode, compliancePeriod, 1, BASELINE_MARKET_RULESET.minimumPrice);
    return {
      seriesCode,
      compliancePeriod,
      entries: await this.listStopOrders(seriesCode, compliancePeriod, true),
      generatedAt: new Date().toISOString(),
    };
  }

  async listTriggerEvents(
    seriesCode: string,
    compliancePeriod: number,
  ): Promise<TriggerEvent[]> {
    if (!this.pool) {
      return [...this.triggerEvents.values()]
        .filter((event) => {
          const stop = this.stopOrders.get(event.stopOrderId);
          return stop?.seriesCode === seriesCode && stop.compliancePeriod === compliancePeriod;
        })
        .sort((left, right) => left.triggeredAt.localeCompare(right.triggeredAt))
        .map((event) => this.withMemoryActivatedTradeIds(event));
    }
    const result = await this.pool.query<TriggerEventRow>(
      `SELECT te.* FROM trigger_events te
       JOIN stop_orders stop ON stop.stop_order_id = te.stop_order_id
       WHERE stop.series_code = $1 AND stop.compliance_period = $2
       ORDER BY te.triggered_at, te.trigger_event_id`,
      [seriesCode, compliancePeriod],
    );
    return Promise.all(result.rows.map((row) => this.mapDbTriggerEvent(row)));
  }

  async getTriggerEvent(triggerEventId: string): Promise<TriggerEvent> {
    if (!this.pool) {
      const event = this.triggerEvents.get(triggerEventId);
      if (!event) throw new NotFoundException(`Trigger event ${triggerEventId} was not found`);
      return this.withMemoryActivatedTradeIds(event);
    }
    const result = await this.pool.query<TriggerEventRow>(
      'SELECT * FROM trigger_events WHERE trigger_event_id = $1',
      [triggerEventId],
    );
    if (!result.rows[0]) {
      throw new NotFoundException(`Trigger event ${triggerEventId} was not found`);
    }
    return this.mapDbTriggerEvent(result.rows[0]);
  }

  async evaluateTriggersForTrade(sourceTradeId: string): Promise<TriggerEvent[]> {
    const trade = await this.getTrade(sourceTradeId);
    const before = new Set(
      (await this.listTriggerEvents(trade.seriesCode, trade.compliancePeriod)).map(
        (event) => event.triggerEventId,
      ),
    );
    await this.processTriggerQueue([trade]);
    return (await this.listTriggerEvents(trade.seriesCode, trade.compliancePeriod)).filter(
      (event) => !before.has(event.triggerEventId),
    );
  }

  private async processTriggerQueue(initialTrades: Trade[]): Promise<void> {
    const queue = [...initialTrades].sort(
      (left, right) => left.tradeSequence - right.tradeSequence,
    );
    while (queue.length > 0) {
      const sourceTrade = queue.shift()!;
      const activations = await this.activateStopsForTrade(sourceTrade);
      for (const activation of activations) {
        const execution = await this.executeMatchesOnce(activation.order.orderId);
        queue.push(...execution.generatedTrades);
      }
      queue.sort((left, right) => left.tradeSequence - right.tradeSequence);
    }
  }

  private async activateStopsForTrade(sourceTrade: Trade): Promise<TriggerActivation[]> {
    const marketKey = `market:${sourceTrade.seriesCode}:${sourceTrade.compliancePeriod}`;
    return this.mutex.runExclusive(marketKey, () =>
      this.pool
        ? this.activateDbStopsForTrade(sourceTrade, marketKey)
        : this.activateMemoryStopsForTrade(sourceTrade),
    );
  }

  private activateMemoryStopsForTrade(sourceTrade: Trade): TriggerActivation[] {
    const eligible = [...this.stopOrders.values()]
      .filter(
        (stop) =>
          stop.seriesCode === sourceTrade.seriesCode &&
          stop.compliancePeriod === sourceTrade.compliancePeriod &&
          stop.status === 'TRIGGER_PENDING' &&
          this.isStopTriggered(stop, sourceTrade.price),
      )
      .sort((left, right) => left.prioritySequence - right.prioritySequence);
    const activations: TriggerActivation[] = [];
    for (const stop of eligible) {
      const now = new Date().toISOString();
      const activated = this.createMemoryActivatedOrder(stop, now);
      const event: TriggerEvent = {
        triggerEventId: randomUUID(),
        stopOrderId: stop.orderId,
        sourceTradeId: sourceTrade.tradeId,
        observedLtp: sourceTrade.price,
        triggerBasis: 'LTP',
        activatedOrderId: activated.orderId,
        activatedTradeIds: [],
        correlationId: randomUUID(),
        triggeredAt: now,
      };
      const updated: StopOrder = {
        ...stop,
        remainingQuantity: 0,
        status: 'ACTIVATED',
        updatedAt: now,
        closedAt: now,
        triggeredAt: now,
        activatedOrderId: activated.orderId,
      };
      this.orders.set(activated.orderId, activated);
      this.stopOrders.set(stop.orderId, updated);
      this.triggerEvents.set(event.triggerEventId, event);
      activations.push({ event, order: activated });
    }
    return activations;
  }

  private async activateDbStopsForTrade(
    sourceTrade: Trade,
    marketKey: string,
  ): Promise<TriggerActivation[]> {
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [marketKey]);
      const candidates = await client.query<StopOrderRow>(
        `SELECT * FROM stop_orders
         WHERE series_code = $1
           AND compliance_period = $2
           AND status = 'TRIGGER_PENDING'
           AND ((side = 'BUY' AND stop_price <= $3) OR (side = 'SELL' AND stop_price >= $3))
         ORDER BY priority_sequence
         FOR UPDATE`,
        [sourceTrade.seriesCode, sourceTrade.compliancePeriod, sourceTrade.price],
      );
      const activations: TriggerActivation[] = [];
      for (const row of candidates.rows) {
        const stop = this.mapStopOrder(row);
        const activatedResult = await client.query<LimitOrderRow>(
          `INSERT INTO limit_orders (
             participant_id, client_order_id, series_code, compliance_period, side, order_type,
             ruleset_id, quantity, remaining_quantity, limit_price, protection_price,
             time_in_force, status, reservation_id, parent_stop_order_id
           ) VALUES ($1, $2, $3, $4, $5, 'MARKET', $6, $7, $7, NULL, $8, 'IOC', 'OPEN', $9, $10)
           RETURNING *`,
          [
            stop.participantId,
            this.activationClientOrderId(stop),
            stop.seriesCode,
            stop.compliancePeriod,
            stop.side,
            stop.rulesetId,
            stop.quantity,
            stop.protectionPrice,
            stop.reservationId,
            stop.orderId,
          ],
        );
        const activated = this.mapOrder(activatedResult.rows[0]!);
        const eventResult = await client.query<TriggerEventRow>(
          `INSERT INTO trigger_events (
             stop_order_id, source_trade_id, observed_ltp, trigger_basis, activated_order_id
           ) VALUES ($1, $2, $3, 'LTP', $4)
           RETURNING *`,
          [stop.orderId, sourceTrade.tradeId, sourceTrade.price, activated.orderId],
        );
        await client.query(
          `UPDATE stop_orders
           SET remaining_quantity = 0, status = 'ACTIVATED', updated_at = now(), closed_at = now()
           WHERE stop_order_id = $1`,
          [stop.orderId],
        );
        activations.push({
          event: { ...this.mapTriggerEvent(eventResult.rows[0]!), activatedTradeIds: [] },
          order: activated,
        });
      }
      await client.query('COMMIT');
      return activations;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async executeMemoryMatches(orderId: string): Promise<MatchExecution> {
    let incoming = this.orders.get(orderId);
    if (!incoming) throw new NotFoundException(`Order ${orderId} was not found`);
    if (!isActive(incoming)) return { order: { ...incoming }, generatedTrades: [] };

    const plans = planMatches(incoming, [...this.orders.values()]);
    if (plans.length === 0) {
      return { order: await this.finalizeMemoryMarketRemainder(incoming), generatedTrades: [] };
    }
    const matchEventId = randomUUID();
    const generatedTrades: Trade[] = [];

    for (const plan of plans) {
      const resting = this.orders.get(plan.restingOrder.orderId)!;
      const quantity = Math.min(
        incoming.remainingQuantity,
        resting.remainingQuantity,
        plan.quantity,
      );
      if (quantity <= 0) continue;
      const buyer = incoming.side === 'BUY' ? incoming : resting;
      const seller = incoming.side === 'SELL' ? incoming : resting;
      const notional = this.safeNotional(quantity, plan.price);

      await this.positionBalanceService.consumeReservation(
        buyer.reservationId,
        quantity,
        this.safeNotional(quantity, this.reservationPrice(buyer)),
        notional,
      );
      await this.positionBalanceService.consumeReservation(seller.reservationId, quantity, 0, 0);

      incoming = this.updateMemoryOrderFill(incoming, quantity);
      this.updateMemoryOrderFill(resting, quantity);
      const now = new Date().toISOString();
      const trade: Trade = {
        tradeId: randomUUID(),
        matchEventId,
        buyerOrderId: buyer.orderId,
        sellerOrderId: seller.orderId,
        buyerParticipantId: buyer.participantId,
        sellerParticipantId: seller.participantId,
        seriesCode: incoming.seriesCode,
        compliancePeriod: incoming.compliancePeriod,
        quantity,
        price: plan.price,
        notional,
        rulesetId: incoming.rulesetId,
        status: 'EXECUTED',
        tradeSequence: this.nextTradeSequence++,
        executedAt: now,
      };
      this.trades.set(trade.tradeId, trade);
      generatedTrades.push({ ...trade });
    }
    return {
      order: await this.finalizeMemoryMarketRemainder(incoming),
      generatedTrades,
    };
  }

  private async executeDbMatches(orderId: string, marketKey: string): Promise<MatchExecution> {
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [marketKey]);
      const incomingResult = await client.query<LimitOrderRow>(
        'SELECT * FROM limit_orders WHERE order_id = $1 FOR UPDATE',
        [orderId],
      );
      if (!incomingResult.rows[0]) throw new NotFoundException(`Order ${orderId} was not found`);
      let incoming = this.mapOrder(incomingResult.rows[0]);
      if (!isActive(incoming)) {
        await client.query('COMMIT');
        return { order: incoming, generatedTrades: [] };
      }

      const priceOperator = incoming.side === 'BUY' ? '<=' : '>=';
      const priceDirection = incoming.side === 'BUY' ? 'ASC' : 'DESC';
      const restingResult = await client.query<LimitOrderRow>(
        `SELECT * FROM limit_orders
         WHERE series_code = $1
           AND compliance_period = $2
           AND side = $3
           AND order_type = 'LIMIT'
           AND status IN ('OPEN', 'PARTIALLY_FILLED')
           AND participant_id <> $4
           AND limit_price ${priceOperator} $5
           AND order_id <> $6
         ORDER BY limit_price ${priceDirection}, priority_sequence ASC
         FOR UPDATE`,
        [
          incoming.seriesCode,
          incoming.compliancePeriod,
          incoming.side === 'BUY' ? 'SELL' : 'BUY',
          incoming.participantId,
          this.executionBoundary(incoming),
          incoming.orderId,
        ],
      );
      const plans = planMatches(
        incoming,
        restingResult.rows.map((row) => this.mapOrder(row)),
      );
      if (plans.length === 0) {
        incoming = await this.finalizeDbMarketRemainder(client, incoming);
        await client.query('COMMIT');
        return { order: incoming, generatedTrades: [] };
      }

      const matchEvent = await client.query<{ match_event_id: string } & QueryResultRow>(
        `INSERT INTO match_events (
           incoming_order_id, series_code, compliance_period, ruleset_id
         ) VALUES ($1, $2, $3, $4)
         RETURNING match_event_id`,
        [incoming.orderId, incoming.seriesCode, incoming.compliancePeriod, incoming.rulesetId],
      );
      const matchEventId = matchEvent.rows[0]!.match_event_id;
      const generatedTrades: Trade[] = [];

      for (const plan of plans) {
        const quantity = Math.min(incoming.remainingQuantity, plan.restingOrder.remainingQuantity);
        if (quantity <= 0) continue;
        const buyer = incoming.side === 'BUY' ? incoming : plan.restingOrder;
        const seller = incoming.side === 'SELL' ? incoming : plan.restingOrder;
        const notional = this.safeNotional(quantity, plan.price);

        await this.positionBalanceService.consumeReservation(
          buyer.reservationId,
          quantity,
          this.safeNotional(quantity, this.reservationPrice(buyer)),
          notional,
          client,
        );
        await this.positionBalanceService.consumeReservation(
          seller.reservationId,
          quantity,
          0,
          0,
          client,
        );

        incoming = await this.updateDbOrderFill(client, incoming, quantity);
        await this.updateDbOrderFill(client, plan.restingOrder, quantity);
        const tradeResult = await client.query<TradeRow>(
          `INSERT INTO trades (
             match_event_id, buyer_order_id, seller_order_id,
             buyer_participant_id, seller_participant_id,
             series_code, compliance_period, quantity, price, notional, ruleset_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            matchEventId,
            buyer.orderId,
            seller.orderId,
            buyer.participantId,
            seller.participantId,
            incoming.seriesCode,
            incoming.compliancePeriod,
            quantity,
            plan.price,
            notional,
            incoming.rulesetId,
          ],
        );
        generatedTrades.push(this.mapTrade(tradeResult.rows[0]!));
      }

      incoming = await this.finalizeDbMarketRemainder(client, incoming);
      await client.query('COMMIT');
      return { order: incoming, generatedTrades };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private updateMemoryOrderFill(order: LimitOrder, quantity: number): LimitOrder {
    const now = new Date().toISOString();
    const remainingQuantity = order.remainingQuantity - quantity;
    const updated: LimitOrder = {
      ...order,
      remainingQuantity,
      status: remainingQuantity === 0 ? 'FILLED' : 'PARTIALLY_FILLED',
      updatedAt: now,
      ...(remainingQuantity === 0 ? { closedAt: now } : {}),
    };
    this.orders.set(order.orderId, updated);
    return updated;
  }

  private async finalizeMemoryMarketRemainder(order: LimitOrder): Promise<LimitOrder> {
    if (order.orderType !== 'MARKET' || order.remainingQuantity === 0) return { ...order };
    await this.positionBalanceService.releaseReservation(order.reservationId);
    const now = new Date().toISOString();
    const cancelled: LimitOrder = {
      ...order,
      status: 'CANCELLED_REMAINDER',
      updatedAt: now,
      closedAt: now,
    };
    this.orders.set(order.orderId, cancelled);
    return { ...cancelled };
  }

  private async finalizeDbMarketRemainder(
    client: PoolClient,
    order: LimitOrder,
  ): Promise<LimitOrder> {
    if (order.orderType !== 'MARKET' || order.remainingQuantity === 0) return order;
    await this.positionBalanceService.releaseReservation(order.reservationId, client);
    const result = await client.query<LimitOrderRow>(
      `UPDATE limit_orders
       SET status = 'CANCELLED_REMAINDER', updated_at = now(), closed_at = now()
       WHERE order_id = $1
       RETURNING *`,
      [order.orderId],
    );
    return this.mapOrder(result.rows[0]!);
  }

  private async updateDbOrderFill(
    client: PoolClient,
    order: LimitOrder,
    quantity: number,
  ): Promise<LimitOrder> {
    const result = await client.query<LimitOrderRow>(
      `UPDATE limit_orders
       SET remaining_quantity = remaining_quantity - $2,
           status = CASE WHEN remaining_quantity - $2 = 0 THEN 'FILLED' ELSE 'PARTIALLY_FILLED' END,
           updated_at = now(),
           closed_at = CASE WHEN remaining_quantity - $2 = 0 THEN now() ELSE NULL END
       WHERE order_id = $1 AND remaining_quantity >= $2
       RETURNING *`,
      [order.orderId, quantity],
    );
    if (!result.rows[0]) {
      throw new BadRequestException({
        code: 'MATCH-ORDER-OVERFILL',
        message: `Order ${order.orderId} does not have enough remaining quantity`,
      });
    }
    return this.mapOrder(result.rows[0]);
  }

  private async closeOrder(
    orderId: string,
    targetStatus: Extract<LimitOrderStatus, 'CANCELLED' | 'EXPIRED'>,
  ): Promise<LimitOrder> {
    const initial = await this.getExecutableOrder(orderId);
    const marketKey = `market:${initial.seriesCode}:${initial.compliancePeriod}`;
    return this.mutex.runExclusive(marketKey, async () => {
      if (this.pool) return this.closeDbOrder(orderId, targetStatus, marketKey);
      const current = await this.getExecutableOrder(orderId);
      if (!isActive(current)) return current;

      const closed = await this.setOrderStatus(current, targetStatus);
      try {
        await this.positionBalanceService.releaseReservation(current.reservationId);
        return closed;
      } catch (error) {
        await this.setOrderStatus(closed, 'OPEN');
        throw error;
      }
    });
  }

  private async closeStopOrder(
    initial: StopOrder,
    targetStatus: Extract<StopOrderStatus, 'CANCELLED' | 'EXPIRED'>,
  ): Promise<StopOrder> {
    const marketKey = `market:${initial.seriesCode}:${initial.compliancePeriod}`;
    return this.mutex.runExclusive(marketKey, async () => {
      if (!this.pool) {
        const current = this.stopOrders.get(initial.orderId)!;
        if (current.status !== 'TRIGGER_PENDING') return { ...current };
        await this.positionBalanceService.releaseReservation(current.reservationId);
        const now = new Date().toISOString();
        const closed: StopOrder = {
          ...current,
          status: targetStatus,
          updatedAt: now,
          closedAt: now,
        };
        this.stopOrders.set(closed.orderId, closed);
        return { ...closed };
      }

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [marketKey]);
        const result = await client.query<StopOrderRow>(
          'SELECT * FROM stop_orders WHERE stop_order_id = $1 FOR UPDATE',
          [initial.orderId],
        );
        if (!result.rows[0]) {
          throw new NotFoundException(`STOP order ${initial.orderId} was not found`);
        }
        const current = this.mapStopOrder(result.rows[0]);
        if (current.status !== 'TRIGGER_PENDING') {
          await client.query('COMMIT');
          return current;
        }
        await this.positionBalanceService.releaseReservation(current.reservationId, client);
        const updated = await client.query<StopOrderRow>(
          `UPDATE stop_orders
           SET status = $2, updated_at = now(), closed_at = now()
           WHERE stop_order_id = $1
           RETURNING *`,
          [current.orderId, targetStatus],
        );
        await client.query('COMMIT');
        return this.mapStopOrder(updated.rows[0]!);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    });
  }

  private async insertStopOrder(
    dto: CreateOrderDto,
    reservationId: string,
  ): Promise<StopOrder> {
    if (!this.pool) {
      const now = new Date().toISOString();
      const order: StopOrder = {
        orderId: randomUUID(),
        participantId: dto.participantId,
        clientOrderId: dto.clientOrderId,
        seriesCode: dto.seriesCode,
        compliancePeriod: dto.compliancePeriod,
        side: dto.side,
        orderType: 'STOP',
        rulesetId: BASELINE_MARKET_RULESET.rulesetId,
        quantity: dto.quantity,
        remainingQuantity: dto.quantity,
        stopPrice: dto.stopPrice!,
        protectionPrice: dto.protectionPrice!,
        triggerBasis: 'LTP',
        activationType: 'MARKET',
        timeInForce: dto.timeInForce as 'DAY' | 'GTC',
        status: 'TRIGGER_PENDING',
        reservationId,
        prioritySequence: this.nextPrioritySequence++,
        createdAt: now,
        updatedAt: now,
      };
      this.stopOrders.set(order.orderId, order);
      return { ...order };
    }

    const result = await this.pool.query<StopOrderRow>(
      `INSERT INTO stop_orders (
         participant_id, client_order_id, series_code, compliance_period, side, ruleset_id,
         quantity, remaining_quantity, stop_price, protection_price, trigger_basis,
         activation_type, time_in_force, status, reservation_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, 'LTP', 'MARKET', $10,
         'TRIGGER_PENDING', $11)
       RETURNING *`,
      [
        dto.participantId,
        dto.clientOrderId,
        dto.seriesCode,
        dto.compliancePeriod,
        dto.side,
        BASELINE_MARKET_RULESET.rulesetId,
        dto.quantity,
        dto.stopPrice,
        dto.protectionPrice,
        dto.timeInForce,
        reservationId,
      ],
    );
    return this.mapStopOrder(result.rows[0]!);
  }

  private async closeDbOrder(
    orderId: string,
    targetStatus: Extract<LimitOrderStatus, 'CANCELLED' | 'EXPIRED'>,
    marketKey: string,
  ): Promise<LimitOrder> {
    const client = await this.pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [marketKey]);
      const currentResult = await client.query<LimitOrderRow>(
        'SELECT * FROM limit_orders WHERE order_id = $1 FOR UPDATE',
        [orderId],
      );
      if (!currentResult.rows[0]) throw new NotFoundException(`Order ${orderId} was not found`);
      const current = this.mapOrder(currentResult.rows[0]);
      if (!isActive(current)) {
        await client.query('COMMIT');
        return current;
      }
      const updatedResult = await client.query<LimitOrderRow>(
        `UPDATE limit_orders
         SET status = $2, updated_at = now(), closed_at = now()
         WHERE order_id = $1
         RETURNING *`,
        [orderId, targetStatus],
      );
      await this.positionBalanceService.releaseReservation(current.reservationId, client);
      await client.query('COMMIT');
      return this.mapOrder(updatedResult.rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async insertOrder(dto: CreateOrderDto, reservationId: string): Promise<LimitOrder> {
    if (dto.orderType === 'STOP') {
      throw new BadRequestException('STOP orders must be inserted into the trigger book');
    }
    if (!this.pool) {
      const now = new Date().toISOString();
      const order: LimitOrder = {
        orderId: randomUUID(),
        participantId: dto.participantId,
        clientOrderId: dto.clientOrderId,
        seriesCode: dto.seriesCode,
        compliancePeriod: dto.compliancePeriod,
        side: dto.side,
        orderType: dto.orderType,
        rulesetId: BASELINE_MARKET_RULESET.rulesetId,
        quantity: dto.quantity,
        remainingQuantity: dto.quantity,
        ...(dto.limitPrice !== undefined ? { limitPrice: dto.limitPrice } : {}),
        ...(dto.protectionPrice !== undefined
          ? { protectionPrice: dto.protectionPrice }
          : {}),
        timeInForce: dto.timeInForce,
        status: 'OPEN',
        reservationId,
        prioritySequence: this.nextPrioritySequence++,
        createdAt: now,
        updatedAt: now,
      };
      this.orders.set(order.orderId, order);
      return { ...order };
    }

    const result = await this.pool.query<LimitOrderRow>(
      `INSERT INTO limit_orders (
         participant_id, client_order_id, series_code, compliance_period, side, order_type,
         ruleset_id, quantity, remaining_quantity, limit_price, protection_price,
         time_in_force, status, reservation_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, 'OPEN', $12)
       RETURNING *`,
      [
        dto.participantId,
        dto.clientOrderId,
        dto.seriesCode,
        dto.compliancePeriod,
        dto.side,
        dto.orderType,
        BASELINE_MARKET_RULESET.rulesetId,
        dto.quantity,
        dto.limitPrice,
        dto.protectionPrice,
        dto.timeInForce,
        reservationId,
      ],
    );
    return this.mapOrder(result.rows[0]!);
  }

  private async findAnyByClientOrderId(
    participantId: string,
    clientOrderId: string,
  ): Promise<Order | undefined> {
    const stop = await this.findStopOrderByClientOrderId(participantId, clientOrderId);
    if (stop) return stop;
    if (!this.pool) {
      const order = [...this.orders.values()].find(
        (candidate) =>
          candidate.participantId === participantId &&
          candidate.clientOrderId === clientOrderId,
      );
      return order ? { ...order } : undefined;
    }
    const result = await this.pool.query<LimitOrderRow>(
      'SELECT * FROM limit_orders WHERE participant_id = $1 AND client_order_id = $2',
      [participantId, clientOrderId],
    );
    return result.rows[0] ? this.mapOrder(result.rows[0]) : undefined;
  }

  private async findStopOrderByClientOrderId(
    participantId: string,
    clientOrderId: string,
  ): Promise<StopOrder | undefined> {
    if (!this.pool) {
      const order = [...this.stopOrders.values()].find(
        (candidate) =>
          candidate.participantId === participantId &&
          candidate.clientOrderId === clientOrderId,
      );
      return order ? { ...order } : undefined;
    }
    const result = await this.pool.query<StopOrderRow>(
      `SELECT stop.*, event.triggered_at, event.activated_order_id
       FROM stop_orders stop
       LEFT JOIN trigger_events event ON event.stop_order_id = stop.stop_order_id
       WHERE stop.participant_id = $1 AND stop.client_order_id = $2`,
      [participantId, clientOrderId],
    );
    return result.rows[0] ? this.mapStopOrder(result.rows[0]) : undefined;
  }

  private async findStopOrderById(orderId: string): Promise<StopOrder | undefined> {
    if (!this.pool) {
      const order = this.stopOrders.get(orderId);
      return order ? { ...order } : undefined;
    }
    const result = await this.pool.query<StopOrderRow>(
      `SELECT stop.*, event.triggered_at, event.activated_order_id
       FROM stop_orders stop
       LEFT JOIN trigger_events event ON event.stop_order_id = stop.stop_order_id
       WHERE stop.stop_order_id = $1`,
      [orderId],
    );
    return result.rows[0] ? this.mapStopOrder(result.rows[0]) : undefined;
  }

  private async listStopOrders(
    seriesCode: string,
    compliancePeriod: number,
    pendingOnly: boolean,
  ): Promise<StopOrder[]> {
    if (!this.pool) {
      return [...this.stopOrders.values()]
        .filter(
          (order) =>
            order.seriesCode === seriesCode &&
            order.compliancePeriod === compliancePeriod &&
            (!pendingOnly || order.status === 'TRIGGER_PENDING'),
        )
        .sort((left, right) => left.prioritySequence - right.prioritySequence)
        .map((order) => ({ ...order }));
    }
    const result = await this.pool.query<StopOrderRow>(
      `SELECT stop.*, event.triggered_at, event.activated_order_id
       FROM stop_orders stop
       LEFT JOIN trigger_events event ON event.stop_order_id = stop.stop_order_id
       WHERE stop.series_code = $1 AND stop.compliance_period = $2
         ${pendingOnly ? "AND stop.status = 'TRIGGER_PENDING'" : ''}
       ORDER BY stop.priority_sequence`,
      [seriesCode, compliancePeriod],
    );
    return result.rows.map((row) => this.mapStopOrder(row));
  }

  private async listOpenOrders(
    seriesCode: string,
    compliancePeriod: number,
  ): Promise<LimitOrder[]> {
    if (!this.pool) {
      return [...this.orders.values()]
        .filter(
          (order) =>
            order.seriesCode === seriesCode &&
            order.compliancePeriod === compliancePeriod &&
            order.orderType === 'LIMIT' &&
            isActive(order),
        )
        .map((order) => ({ ...order }));
    }
    const result = await this.pool.query<LimitOrderRow>(
      `SELECT * FROM limit_orders
       WHERE series_code = $1
         AND compliance_period = $2
         AND order_type = 'LIMIT'
         AND status IN ('OPEN', 'PARTIALLY_FILLED')`,
      [seriesCode, compliancePeriod],
    );
    return result.rows.map((row) => this.mapOrder(row));
  }

  private async setOrderStatus(
    order: LimitOrder,
    status: LimitOrderStatus,
  ): Promise<LimitOrder> {
    if (!this.pool) {
      const now = new Date().toISOString();
      const updated: LimitOrder = {
        ...order,
        status,
        updatedAt: now,
        ...(status === 'OPEN' ? { closedAt: undefined } : { closedAt: now }),
      };
      this.orders.set(order.orderId, updated);
      return { ...updated };
    }
    const result = await this.pool.query<LimitOrderRow>(
      `UPDATE limit_orders
       SET status = $2, updated_at = now(), closed_at = CASE WHEN $2 = 'OPEN' THEN NULL ELSE now() END
       WHERE order_id = $1
       RETURNING *`,
      [order.orderId, status],
    );
    return this.mapOrder(result.rows[0]!);
  }

  private aggregateLevels(orders: LimitOrder[]): OrderBookLevel[] {
    const levels = new Map<number, OrderBookLevel>();
    for (const order of orders) {
      const level = levels.get(order.limitPrice!) ?? {
        price: order.limitPrice!,
        quantity: 0,
        orderCount: 0,
      };
      level.quantity += order.remainingQuantity;
      level.orderCount += 1;
      levels.set(order.limitPrice!, level);
    }
    return [...levels.values()];
  }

  private validateOrderCommand(dto: CreateOrderDto): number {
    if (dto.orderType === 'LIMIT') {
      if (
        dto.limitPrice === undefined ||
        dto.protectionPrice !== undefined ||
        dto.stopPrice !== undefined ||
        dto.triggerBasis !== undefined ||
        dto.activationType !== undefined ||
        !['DAY', 'GTC'].includes(dto.timeInForce)
      ) {
        throw new BadRequestException({
          code: 'ORD-INVALID-LIMIT-FIELDS',
          message: 'LIMIT requires limitPrice, DAY/GTC, and no protectionPrice',
        });
      }
      return dto.limitPrice;
    }
    if (dto.orderType === 'STOP') {
      if (
        dto.limitPrice !== undefined ||
        dto.stopPrice === undefined ||
        dto.protectionPrice === undefined ||
        dto.triggerBasis !== 'LTP' ||
        dto.activationType !== 'MARKET' ||
        !['DAY', 'GTC'].includes(dto.timeInForce)
      ) {
        throw new BadRequestException({
          code: 'ORD-INVALID-STOP-FIELDS',
          message:
            'STOP requires stopPrice, protectionPrice, LTP trigger, MARKET activation, DAY/GTC, and no limitPrice',
        });
      }
      validateAgainstRuleset(
        dto.seriesCode,
        dto.compliancePeriod,
        dto.quantity,
        dto.stopPrice,
      );
      if (
        (dto.side === 'BUY' && dto.protectionPrice < dto.stopPrice) ||
        (dto.side === 'SELL' && dto.protectionPrice > dto.stopPrice)
      ) {
        throw new BadRequestException({
          code: 'ORD-INVALID-STOP-PROTECTION',
          message:
            'BUY STOP protection must be at or above stopPrice; SELL STOP protection must be at or below stopPrice',
        });
      }
      return dto.protectionPrice;
    }
    if (
      dto.limitPrice !== undefined ||
      dto.stopPrice !== undefined ||
      dto.triggerBasis !== undefined ||
      dto.activationType !== undefined ||
      dto.protectionPrice === undefined ||
      dto.timeInForce !== 'IOC'
    ) {
      throw new BadRequestException({
        code: 'ORD-INVALID-MARKET-FIELDS',
        message: 'MARKET requires protectionPrice and IOC, and does not accept limitPrice',
      });
    }
    return dto.protectionPrice;
  }

  private reservationPrice(order: LimitOrder): number {
    return order.orderType === 'MARKET' ? order.protectionPrice! : order.limitPrice!;
  }

  private executionBoundary(order: LimitOrder): number {
    return this.reservationPrice(order);
  }

  private assertSamePayload(existing: Order, dto: CreateOrderDto): void {
    const sameTypeFields =
      existing.orderType === 'STOP'
        ? existing.stopPrice === dto.stopPrice &&
          existing.triggerBasis === dto.triggerBasis &&
          existing.activationType === dto.activationType
        : existing.limitPrice === dto.limitPrice;
    if (
      existing.seriesCode !== dto.seriesCode ||
      existing.compliancePeriod !== dto.compliancePeriod ||
      existing.side !== dto.side ||
      existing.orderType !== dto.orderType ||
      existing.quantity !== dto.quantity ||
      existing.protectionPrice !== dto.protectionPrice ||
      existing.timeInForce !== dto.timeInForce ||
      !sameTypeFields
    ) {
      throw new BadRequestException({
        code: 'ORD-IDEMPOTENCY-CONFLICT',
        message: 'Client order ID was already used with a different order payload',
      });
    }
  }

  private safeNotional(quantity: number, price: number): number {
    const notional = quantity * price;
    if (!Number.isSafeInteger(notional) || notional <= 0) {
      throw new BadRequestException({
        code: 'MATCH-NOTIONAL-OVERFLOW',
        message: 'Trade notional exceeds the supported safe integer range',
      });
    }
    return notional;
  }

  private mapOrder(row: LimitOrderRow): LimitOrder {
    return {
      orderId: row.order_id,
      participantId: row.participant_id,
      clientOrderId: row.client_order_id,
      seriesCode: row.series_code,
      compliancePeriod: row.compliance_period,
      side: row.side,
      orderType: row.order_type,
      rulesetId: row.ruleset_id,
      quantity: this.toSafeNumber(row.quantity, 'quantity'),
      remainingQuantity: this.toSafeNumber(row.remaining_quantity, 'remaining_quantity'),
      ...(row.limit_price !== null
        ? { limitPrice: this.toSafeNumber(row.limit_price, 'limit_price') }
        : {}),
      ...(row.protection_price !== null
        ? { protectionPrice: this.toSafeNumber(row.protection_price, 'protection_price') }
        : {}),
      timeInForce: row.time_in_force,
      status: row.status,
      reservationId: row.reservation_id,
      ...(row.parent_stop_order_id ? { parentStopOrderId: row.parent_stop_order_id } : {}),
      prioritySequence: this.toSafeNumber(row.priority_sequence, 'priority_sequence'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(row.closed_at ? { closedAt: row.closed_at.toISOString() } : {}),
    };
  }

  private createMemoryActivatedOrder(stop: StopOrder, now: string): LimitOrder {
    return {
      orderId: randomUUID(),
      participantId: stop.participantId,
      clientOrderId: this.activationClientOrderId(stop),
      seriesCode: stop.seriesCode,
      compliancePeriod: stop.compliancePeriod,
      side: stop.side,
      orderType: 'MARKET',
      rulesetId: stop.rulesetId,
      quantity: stop.quantity,
      remainingQuantity: stop.quantity,
      protectionPrice: stop.protectionPrice,
      timeInForce: 'IOC',
      status: 'OPEN',
      reservationId: stop.reservationId,
      parentStopOrderId: stop.orderId,
      prioritySequence: this.nextPrioritySequence++,
      createdAt: now,
      updatedAt: now,
    };
  }

  private activationClientOrderId(stop: StopOrder): string {
    return `STOP-ACT:${stop.orderId}`;
  }

  private isStopTriggered(stop: StopOrder, ltp: number): boolean {
    return stop.side === 'BUY' ? ltp >= stop.stopPrice : ltp <= stop.stopPrice;
  }

  private mapStopOrder(row: StopOrderRow): StopOrder {
    return {
      orderId: row.stop_order_id,
      participantId: row.participant_id,
      clientOrderId: row.client_order_id,
      seriesCode: row.series_code,
      compliancePeriod: row.compliance_period,
      side: row.side,
      orderType: 'STOP',
      rulesetId: row.ruleset_id,
      quantity: this.toSafeNumber(row.quantity, 'quantity'),
      remainingQuantity: this.toSafeNumber(row.remaining_quantity, 'remaining_quantity'),
      stopPrice: this.toSafeNumber(row.stop_price, 'stop_price'),
      protectionPrice: this.toSafeNumber(row.protection_price, 'protection_price'),
      triggerBasis: row.trigger_basis,
      activationType: row.activation_type,
      timeInForce: row.time_in_force,
      status: row.status,
      reservationId: row.reservation_id,
      prioritySequence: this.toSafeNumber(row.priority_sequence, 'priority_sequence'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(row.closed_at ? { closedAt: row.closed_at.toISOString() } : {}),
      ...(row.triggered_at ? { triggeredAt: row.triggered_at.toISOString() } : {}),
      ...(row.activated_order_id ? { activatedOrderId: row.activated_order_id } : {}),
    };
  }

  private mapTriggerEvent(row: TriggerEventRow): TriggerEvent {
    return {
      triggerEventId: row.trigger_event_id,
      stopOrderId: row.stop_order_id,
      sourceTradeId: row.source_trade_id,
      observedLtp: this.toSafeNumber(row.observed_ltp, 'observed_ltp'),
      triggerBasis: row.trigger_basis,
      activatedOrderId: row.activated_order_id,
      activatedTradeIds: [],
      correlationId: row.correlation_id,
      triggeredAt: row.triggered_at.toISOString(),
    };
  }

  private async mapDbTriggerEvent(row: TriggerEventRow): Promise<TriggerEvent> {
    const trades = await this.pool!.query<{ trade_id: string } & QueryResultRow>(
      `SELECT trade_id FROM trades
       WHERE buyer_order_id = $1 OR seller_order_id = $1
       ORDER BY trade_sequence`,
      [row.activated_order_id],
    );
    return {
      ...this.mapTriggerEvent(row),
      activatedTradeIds: trades.rows.map((trade) => trade.trade_id),
    };
  }

  private withMemoryActivatedTradeIds(event: TriggerEvent): TriggerEvent {
    return {
      ...event,
      activatedTradeIds: [...this.trades.values()]
        .filter(
          (trade) =>
            trade.buyerOrderId === event.activatedOrderId ||
            trade.sellerOrderId === event.activatedOrderId,
        )
        .sort((left, right) => left.tradeSequence - right.tradeSequence)
        .map((trade) => trade.tradeId),
    };
  }

  private mapTrade(row: TradeRow): Trade {
    return {
      tradeId: row.trade_id,
      matchEventId: row.match_event_id,
      buyerOrderId: row.buyer_order_id,
      sellerOrderId: row.seller_order_id,
      buyerParticipantId: row.buyer_participant_id,
      sellerParticipantId: row.seller_participant_id,
      seriesCode: row.series_code,
      compliancePeriod: row.compliance_period,
      quantity: this.toSafeNumber(row.quantity, 'quantity'),
      price: this.toSafeNumber(row.price, 'price'),
      notional: this.toSafeNumber(row.notional, 'notional'),
      rulesetId: row.ruleset_id,
      status: row.status,
      tradeSequence: this.toSafeNumber(row.trade_sequence, 'trade_sequence'),
      executedAt: row.executed_at.toISOString(),
    };
  }

  private toSafeNumber(value: string, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds JavaScript safe integer range`);
    return parsed;
  }
}
