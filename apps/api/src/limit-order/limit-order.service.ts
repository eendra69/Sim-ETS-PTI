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
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
  OrderType,
  Trade,
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
  order_type: OrderType;
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

  async submit(dto: CreateOrderDto): Promise<LimitOrder> {
    return this.mutex.runExclusive(
      `client:${dto.participantId}:${dto.clientOrderId}`,
      async () => {
        const existing = await this.findByClientOrderId(dto.participantId, dto.clientOrderId);
        if (existing) {
          this.assertSamePayload(existing, dto);
          return isActive(existing) ? this.executeMatches(existing.orderId) : existing;
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
          inserted = await this.insertOrder(dto, reservation.reservationId);
        } catch (error) {
          const concurrentlyCreated = await this.findByClientOrderId(
            dto.participantId,
            dto.clientOrderId,
          );
          if (concurrentlyCreated) {
            this.assertSamePayload(concurrentlyCreated, dto);
            return concurrentlyCreated;
          }
          await this.positionBalanceService.releaseReservation(reservation.reservationId);
          throw error;
        }
        return this.executeMatches(inserted.orderId);
      },
    );
  }

  async getOrder(orderId: string): Promise<LimitOrder> {
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

  async listOrders(seriesCode: string, compliancePeriod: number): Promise<LimitOrder[]> {
    if (!this.pool) {
      return [...this.orders.values()]
        .filter(
          (order) =>
            order.seriesCode === seriesCode && order.compliancePeriod === compliancePeriod,
        )
        .sort((left, right) => left.prioritySequence - right.prioritySequence)
        .map((order) => ({ ...order }));
    }
    const result = await this.pool.query<LimitOrderRow>(
      `SELECT * FROM limit_orders
       WHERE series_code = $1 AND compliance_period = $2
       ORDER BY priority_sequence`,
      [seriesCode, compliancePeriod],
    );
    return result.rows.map((row) => this.mapOrder(row));
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
    const order = await this.getOrder(orderId);
    if (!isActive(order)) return order;
    const marketKey = `market:${order.seriesCode}:${order.compliancePeriod}`;
    return this.mutex.runExclusive(marketKey, () =>
      this.pool ? this.executeDbMatches(orderId, marketKey) : this.executeMemoryMatches(orderId),
    );
  }

  async cancel(orderId: string): Promise<LimitOrder> {
    return this.closeOrder(orderId, 'CANCELLED');
  }

  async expireDayOrders(seriesCode: string, compliancePeriod: number): Promise<LimitOrder[]> {
    const candidates = (await this.listOpenOrders(seriesCode, compliancePeriod)).filter(
      (order) => order.timeInForce === 'DAY',
    );
    const expired: LimitOrder[] = [];
    for (const order of candidates) {
      expired.push(await this.closeOrder(order.orderId, 'EXPIRED'));
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

  private async executeMemoryMatches(orderId: string): Promise<LimitOrder> {
    let incoming = this.orders.get(orderId);
    if (!incoming) throw new NotFoundException(`Order ${orderId} was not found`);
    if (!isActive(incoming)) return { ...incoming };

    const plans = planMatches(incoming, [...this.orders.values()]);
    if (plans.length === 0) return this.finalizeMemoryMarketRemainder(incoming);
    const matchEventId = randomUUID();

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
    }
    return this.finalizeMemoryMarketRemainder(incoming);
  }

  private async executeDbMatches(orderId: string, marketKey: string): Promise<LimitOrder> {
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
        return incoming;
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
        return incoming;
      }

      const matchEvent = await client.query<{ match_event_id: string } & QueryResultRow>(
        `INSERT INTO match_events (
           incoming_order_id, series_code, compliance_period, ruleset_id
         ) VALUES ($1, $2, $3, $4)
         RETURNING match_event_id`,
        [incoming.orderId, incoming.seriesCode, incoming.compliancePeriod, incoming.rulesetId],
      );
      const matchEventId = matchEvent.rows[0]!.match_event_id;

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
        await client.query(
          `INSERT INTO trades (
             match_event_id, buyer_order_id, seller_order_id,
             buyer_participant_id, seller_participant_id,
             series_code, compliance_period, quantity, price, notional, ruleset_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
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
      }

      incoming = await this.finalizeDbMarketRemainder(client, incoming);
      await client.query('COMMIT');
      return incoming;
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
    const initial = await this.getOrder(orderId);
    const marketKey = `market:${initial.seriesCode}:${initial.compliancePeriod}`;
    return this.mutex.runExclusive(marketKey, async () => {
      if (this.pool) return this.closeDbOrder(orderId, targetStatus, marketKey);
      const current = await this.getOrder(orderId);
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
    if (!this.pool) {
      const now = new Date().toISOString();
      const order: LimitOrder = {
        orderId: randomUUID(),
        ...dto,
        rulesetId: BASELINE_MARKET_RULESET.rulesetId,
        remainingQuantity: dto.quantity,
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

  private async findByClientOrderId(
    participantId: string,
    clientOrderId: string,
  ): Promise<LimitOrder | undefined> {
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
        !['DAY', 'GTC'].includes(dto.timeInForce)
      ) {
        throw new BadRequestException({
          code: 'ORD-INVALID-LIMIT-FIELDS',
          message: 'LIMIT requires limitPrice, DAY/GTC, and no protectionPrice',
        });
      }
      return dto.limitPrice;
    }
    if (
      dto.limitPrice !== undefined ||
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

  private assertSamePayload(existing: LimitOrder, dto: CreateOrderDto): void {
    if (
      existing.seriesCode !== dto.seriesCode ||
      existing.compliancePeriod !== dto.compliancePeriod ||
      existing.side !== dto.side ||
      existing.orderType !== dto.orderType ||
      existing.quantity !== dto.quantity ||
      existing.limitPrice !== dto.limitPrice ||
      existing.protectionPrice !== dto.protectionPrice ||
      existing.timeInForce !== dto.timeInForce
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
      prioritySequence: this.toSafeNumber(row.priority_sequence, 'priority_sequence'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(row.closed_at ? { closedAt: row.closed_at.toISOString() } : {}),
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
