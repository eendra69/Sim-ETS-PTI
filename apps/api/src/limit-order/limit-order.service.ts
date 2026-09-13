import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, QueryResultRow } from 'pg';
import { KeyedMutex } from '../common/keyed-mutex';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { CreateLimitOrderDto } from './dto/create-limit-order.dto';
import {
  LimitOrder,
  LimitOrderStatus,
  OrderBookLevel,
  OrderBookSnapshot,
  OrderSide,
} from './limit-order.types';
import { BASELINE_MARKET_RULESET, validateAgainstRuleset } from './market-ruleset';

interface LimitOrderRow extends QueryResultRow {
  order_id: string;
  participant_id: string;
  client_order_id: string;
  series_code: string;
  compliance_period: number;
  side: OrderSide;
  order_type: 'LIMIT';
  ruleset_id: string;
  quantity: string;
  remaining_quantity: string;
  limit_price: string;
  time_in_force: 'DAY' | 'GTC';
  status: LimitOrderStatus;
  reservation_id: string;
  priority_sequence: string;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}

@Injectable()
export class LimitOrderService implements OnModuleDestroy {
  private readonly orders = new Map<string, LimitOrder>();
  private readonly mutex = new KeyedMutex();
  private readonly pool?: Pool;
  private nextPrioritySequence = 1;

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

  async submit(dto: CreateLimitOrderDto): Promise<LimitOrder> {
    return this.mutex.runExclusive(
      `client:${dto.participantId}:${dto.clientOrderId}`,
      async () => {
        const existing = await this.findByClientOrderId(dto.participantId, dto.clientOrderId);
        if (existing) {
          this.assertSamePayload(existing, dto);
          return existing;
        }

        validateAgainstRuleset(
          dto.seriesCode,
          dto.compliancePeriod,
          dto.quantity,
          dto.limitPrice,
        );

        const maximumNotional = dto.quantity * dto.limitPrice;
        if (!Number.isSafeInteger(maximumNotional)) {
          throw new BadRequestException({
            code: 'ORD-NOTIONAL-OVERFLOW',
            message: 'Order notional exceeds the supported safe integer range',
          });
        }

        const orderReference = `LIMIT:${dto.clientOrderId}`;
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

        try {
          return await this.insertOrder(dto, reservation.reservationId);
        } catch (error) {
          await this.positionBalanceService.releaseReservation(reservation.reservationId);
          throw error;
        }
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
          right.limitPrice - left.limitPrice || left.prioritySequence - right.prioritySequence,
      );
    const asks = open
      .filter((order) => order.side === 'SELL')
      .sort(
        (left, right) =>
          left.limitPrice - right.limitPrice || left.prioritySequence - right.prioritySequence,
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

  private async closeOrder(
    orderId: string,
    targetStatus: Extract<LimitOrderStatus, 'CANCELLED' | 'EXPIRED'>,
  ): Promise<LimitOrder> {
    return this.mutex.runExclusive(`order:${orderId}`, async () => {
      const current = await this.getOrder(orderId);
      if (current.status !== 'OPEN') return current;

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

  private async insertOrder(dto: CreateLimitOrderDto, reservationId: string): Promise<LimitOrder> {
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
         ruleset_id, quantity, remaining_quantity, limit_price, time_in_force, status, reservation_id
       ) VALUES ($1, $2, $3, $4, $5, 'LIMIT', $6, $7, $7, $8, $9, 'OPEN', $10)
       RETURNING *`,
      [
        dto.participantId,
        dto.clientOrderId,
        dto.seriesCode,
        dto.compliancePeriod,
        dto.side,
        BASELINE_MARKET_RULESET.rulesetId,
        dto.quantity,
        dto.limitPrice,
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
            order.status === 'OPEN',
        )
        .map((order) => ({ ...order }));
    }
    const result = await this.pool.query<LimitOrderRow>(
      `SELECT * FROM limit_orders
       WHERE series_code = $1 AND compliance_period = $2 AND status = 'OPEN'`,
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
      const level = levels.get(order.limitPrice) ?? {
        price: order.limitPrice,
        quantity: 0,
        orderCount: 0,
      };
      level.quantity += order.remainingQuantity;
      level.orderCount += 1;
      levels.set(order.limitPrice, level);
    }
    return [...levels.values()];
  }

  private assertSamePayload(existing: LimitOrder, dto: CreateLimitOrderDto): void {
    if (
      existing.seriesCode !== dto.seriesCode ||
      existing.compliancePeriod !== dto.compliancePeriod ||
      existing.side !== dto.side ||
      existing.orderType !== dto.orderType ||
      existing.quantity !== dto.quantity ||
      existing.limitPrice !== dto.limitPrice ||
      existing.timeInForce !== dto.timeInForce
    ) {
      throw new BadRequestException({
        code: 'ORD-IDEMPOTENCY-CONFLICT',
        message: 'Client order ID was already used with a different order payload',
      });
    }
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
      limitPrice: this.toSafeNumber(row.limit_price, 'limit_price'),
      timeInForce: row.time_in_force,
      status: row.status,
      reservationId: row.reservation_id,
      prioritySequence: this.toSafeNumber(row.priority_sequence, 'priority_sequence'),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      ...(row.closed_at ? { closedAt: row.closed_at.toISOString() } : {}),
    };
  }

  private toSafeNumber(value: string, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds JavaScript safe integer range`);
    return parsed;
  }
}
