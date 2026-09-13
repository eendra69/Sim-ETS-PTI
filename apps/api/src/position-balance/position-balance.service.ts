import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { KeyedMutex } from '../common/keyed-mutex';
import { CreateBuyReservationDto, CreateSellReservationDto } from './dto/create-reservation.dto';
import { demoBalances, demoPositions } from './demo-fixtures';
import { calculatePosition } from './position-calculator';
import {
  AnnualPositionInput,
  BalanceAccount,
  BalanceReservation,
  PositionSnapshot,
} from './position.types';

interface PositionBalanceRow extends QueryResultRow {
  participant_id: string;
  participant_name: string;
  series_code: string;
  compliance_period: number;
  allocated_quota: string;
  verified_emission: string;
  acknowledged_purchases: string;
  acknowledged_sales: string;
  eligible_banked_units: string;
  eligible_offset_applied: string;
  eligible_holding: string;
  locked_units: string;
  surrendered_units: string;
  reserved_sell: string;
  executed_sell_pending: string;
  buying_capacity: string;
  reserved_buy_funds: string;
  reserved_buy_quantity: string;
  executed_buy_pending: string;
  executed_buy_pending_funds: string;
  version: number;
}

interface ReservationRow extends QueryResultRow {
  reservation_id: string;
  participant_id: string;
  series_code: string;
  compliance_period: number;
  order_reference: string;
  kind: BalanceReservation['kind'];
  quantity: string;
  amount: string;
  remaining_quantity: string;
  remaining_amount: string;
  status: BalanceReservation['status'];
  created_at: Date;
  released_at: Date | null;
  consumed_at: Date | null;
}

@Injectable()
export class PositionBalanceService implements OnModuleDestroy {
  private readonly positions = new Map<string, AnnualPositionInput>();
  private readonly balances = new Map<string, BalanceAccount>();
  private readonly reservations = new Map<string, BalanceReservation>();
  private readonly mutex = new KeyedMutex();
  private readonly pool?: Pool;

  constructor() {
    const usePostgres =
      process.env.NODE_ENV !== 'test' && process.env.PERSISTENCE_MODE === 'postgres';

    if (usePostgres) {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');
      }
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
      return;
    }

    for (const position of demoPositions) {
      this.positions.set(this.key(position.participantId, position.seriesCode, position.compliancePeriod), {
        ...position,
      });
    }
    for (const balance of demoBalances) {
      this.balances.set(this.key(balance.participantId, balance.seriesCode, balance.compliancePeriod), {
        ...balance,
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async listPositions(seriesCode: string, compliancePeriod: number): Promise<PositionSnapshot[]> {
    if (!this.pool) {
      return [...this.positions.values()]
        .filter(
          (position) =>
            position.seriesCode === seriesCode && position.compliancePeriod === compliancePeriod,
        )
        .map((position) => this.snapshot(position))
        .sort((left, right) => left.participantId.localeCompare(right.participantId));
    }

    const result = await this.pool.query<PositionBalanceRow>(
      `${this.positionSelectSql()}
       WHERE p.series_code = $1 AND p.compliance_period = $2
       ORDER BY p.participant_id`,
      [seriesCode, compliancePeriod],
    );
    return result.rows.map((row) => this.snapshotFromRow(row));
  }

  async getPosition(
    participantId: string,
    seriesCode: string,
    compliancePeriod: number,
  ): Promise<PositionSnapshot> {
    if (!this.pool) {
      return this.snapshot(this.requirePosition(participantId, seriesCode, compliancePeriod));
    }

    const { position, balance } = await this.requireDbState(
      this.pool,
      participantId,
      seriesCode,
      compliancePeriod,
    );
    return calculatePosition(position, balance);
  }

  async reserveSell(dto: CreateSellReservationDto): Promise<BalanceReservation> {
    if (this.pool) {
      return this.withTransaction(async (client) => {
        const { position, balance } = await this.requireDbState(
          client,
          dto.participantId,
          dto.seriesCode,
          dto.compliancePeriod,
          true,
        );
        const existing = await this.findExistingDbReservation(client, dto, 'SELL_QUOTA', dto.quantity, 0);
        if (existing) return existing;

        const snapshot = calculatePosition(position, balance);
        if (dto.quantity > snapshot.availableToSell) {
          throw this.insufficientSell(snapshot.availableToSell);
        }

        await client.query(
          `UPDATE balance_accounts
             SET reserved_sell = reserved_sell + $4, version = version + 1, updated_at = now()
           WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3`,
          [dto.participantId, dto.seriesCode, dto.compliancePeriod, dto.quantity],
        );
        return this.insertDbReservation(client, dto, 'SELL_QUOTA', dto.quantity, 0);
      });
    }

    const key = this.key(dto.participantId, dto.seriesCode, dto.compliancePeriod);
    return this.mutex.runExclusive(key, () => {
      const existing = this.findExistingReservation(dto, 'SELL_QUOTA', dto.quantity, 0);
      if (existing) return existing;

      const position = this.requirePosition(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const balance = this.requireBalance(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const snapshot = calculatePosition(position, balance);
      if (dto.quantity > snapshot.availableToSell) {
        throw this.insufficientSell(snapshot.availableToSell);
      }

      balance.reservedSell += dto.quantity;
      balance.version += 1;
      return this.createReservation(dto, 'SELL_QUOTA', dto.quantity, 0);
    });
  }

  async reserveBuy(dto: CreateBuyReservationDto): Promise<BalanceReservation> {
    const amount = dto.maximumNotional + dto.feeBuffer;
    this.assertSafeMoney(amount);

    if (this.pool) {
      return this.withTransaction(async (client) => {
        const { position, balance } = await this.requireDbState(
          client,
          dto.participantId,
          dto.seriesCode,
          dto.compliancePeriod,
          true,
        );
        const existing = await this.findExistingDbReservation(
          client,
          dto,
          'BUY_FUNDS',
          dto.quantity,
          amount,
        );
        if (existing) return existing;

        const snapshot = calculatePosition(position, balance);
        this.assertBuyCapacity(dto.quantity, amount, snapshot);

        await client.query(
          `UPDATE balance_accounts
             SET reserved_buy_funds = reserved_buy_funds + $4,
                 reserved_buy_quantity = reserved_buy_quantity + $5,
                 version = version + 1,
                 updated_at = now()
           WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3`,
          [dto.participantId, dto.seriesCode, dto.compliancePeriod, amount, dto.quantity],
        );
        return this.insertDbReservation(client, dto, 'BUY_FUNDS', dto.quantity, amount);
      });
    }

    const key = this.key(dto.participantId, dto.seriesCode, dto.compliancePeriod);
    return this.mutex.runExclusive(key, () => {
      const existing = this.findExistingReservation(dto, 'BUY_FUNDS', dto.quantity, amount);
      if (existing) return existing;

      const position = this.requirePosition(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const balance = this.requireBalance(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const snapshot = calculatePosition(position, balance);
      this.assertBuyCapacity(dto.quantity, amount, snapshot);

      balance.reservedBuyFunds += amount;
      balance.reservedBuyQuantity += dto.quantity;
      balance.version += 1;
      return this.createReservation(dto, 'BUY_FUNDS', dto.quantity, amount);
    });
  }

  async consumeReservation(
    reservationId: string,
    quantity: number,
    reservedAmount: number,
    executedAmount: number,
    transaction?: PoolClient,
  ): Promise<BalanceReservation> {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('Consumed quantity must be a positive safe integer');
    }
    for (const [field, value] of [
      ['reservedAmount', reservedAmount],
      ['executedAmount', executedAmount],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new BadRequestException(`${field} must be a non-negative safe integer`);
      }
    }

    if (this.pool) {
      const operation = (client: PoolClient) =>
        this.consumeDbReservation(
          client,
          reservationId,
          quantity,
          reservedAmount,
          executedAmount,
        );
      return transaction ? operation(transaction) : this.withTransaction(operation);
    }

    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new NotFoundException(`Reservation ${reservationId} was not found`);
    const key = this.key(
      reservation.participantId,
      reservation.seriesCode,
      reservation.compliancePeriod,
    );
    return this.mutex.runExclusive(key, () => {
      this.assertConsumable(reservation, quantity, reservedAmount, executedAmount);
      const balance = this.requireBalance(
        reservation.participantId,
        reservation.seriesCode,
        reservation.compliancePeriod,
      );
      if (reservation.kind === 'SELL_QUOTA') {
        balance.reservedSell -= quantity;
        balance.executedSellPending += quantity;
      } else {
        balance.reservedBuyFunds -= reservedAmount;
        balance.reservedBuyQuantity -= quantity;
        balance.executedBuyPending += quantity;
        balance.executedBuyPendingFunds += executedAmount;
      }
      balance.version += 1;
      reservation.remainingQuantity -= quantity;
      reservation.remainingAmount -= reservedAmount;
      if (reservation.remainingQuantity === 0) {
        reservation.status = 'CONSUMED';
        reservation.consumedAt = new Date().toISOString();
      }
      return { ...reservation };
    });
  }

  async releaseReservation(
    reservationId: string,
    transaction?: PoolClient,
  ): Promise<BalanceReservation> {
    if (this.pool) {
      const operation = (client: PoolClient) => this.releaseDbReservation(client, reservationId);
      return transaction ? operation(transaction) : this.withTransaction(operation);
    }

    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new NotFoundException(`Reservation ${reservationId} was not found`);
    const key = this.key(
      reservation.participantId,
      reservation.seriesCode,
      reservation.compliancePeriod,
    );

    return this.mutex.runExclusive(key, () => {
      if (reservation.status !== 'ACTIVE') return { ...reservation };
      const balance = this.requireBalance(
        reservation.participantId,
        reservation.seriesCode,
        reservation.compliancePeriod,
      );
      if (reservation.kind === 'SELL_QUOTA') {
        balance.reservedSell -= reservation.remainingQuantity;
      } else {
        balance.reservedBuyFunds -= reservation.remainingAmount;
        balance.reservedBuyQuantity -= reservation.remainingQuantity;
      }
      balance.version += 1;
      reservation.status = 'RELEASED';
      reservation.remainingQuantity = 0;
      reservation.remainingAmount = 0;
      reservation.releasedAt = new Date().toISOString();
      return { ...reservation };
    });
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

  private async requireDbState(
    queryable: Pick<Pool, 'query'> | PoolClient,
    participantId: string,
    seriesCode: string,
    compliancePeriod: number,
    lock = false,
  ): Promise<{ position: AnnualPositionInput; balance: BalanceAccount }> {
    const result = await queryable.query<PositionBalanceRow>(
      `${this.positionSelectSql()}
       WHERE p.participant_id = $1 AND p.series_code = $2 AND p.compliance_period = $3
       ${lock ? 'FOR UPDATE OF b' : ''}`,
      [participantId, seriesCode, compliancePeriod],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(
        `Position ${participantId}/${seriesCode}/${compliancePeriod} was not found`,
      );
    }
    return this.stateFromRow(row);
  }

  private positionSelectSql(): string {
    return `SELECT
      p.participant_id,
      participant.legal_name AS participant_name,
      p.series_code,
      p.compliance_period,
      p.allocated_quota,
      p.verified_emission,
      p.acknowledged_purchases,
      p.acknowledged_sales,
      p.eligible_banked_units,
      p.eligible_offset_applied,
      b.eligible_holding,
      b.locked_units,
      b.surrendered_units,
      b.reserved_sell,
      b.executed_sell_pending,
      b.buying_capacity,
      b.reserved_buy_funds,
      b.reserved_buy_quantity,
      b.executed_buy_pending,
      b.executed_buy_pending_funds,
      b.version
    FROM annual_compliance_positions p
    JOIN participants participant ON participant.participant_id = p.participant_id
    JOIN balance_accounts b
      ON b.participant_id = p.participant_id
     AND b.series_code = p.series_code
     AND b.compliance_period = p.compliance_period`;
  }

  private stateFromRow(row: PositionBalanceRow): {
    position: AnnualPositionInput;
    balance: BalanceAccount;
  } {
    const position: AnnualPositionInput = {
      participantId: row.participant_id,
      participantName: row.participant_name,
      seriesCode: row.series_code,
      compliancePeriod: row.compliance_period,
      allocatedQuota: this.toSafeNumber(row.allocated_quota, 'allocated_quota'),
      verifiedEmission: this.toSafeNumber(row.verified_emission, 'verified_emission'),
      acknowledgedPurchases: this.toSafeNumber(row.acknowledged_purchases, 'acknowledged_purchases'),
      acknowledgedSales: this.toSafeNumber(row.acknowledged_sales, 'acknowledged_sales'),
      eligibleBankedUnits: this.toSafeNumber(row.eligible_banked_units, 'eligible_banked_units'),
      eligibleOffsetApplied: this.toSafeNumber(row.eligible_offset_applied, 'eligible_offset_applied'),
    };
    const balance: BalanceAccount = {
      participantId: row.participant_id,
      seriesCode: row.series_code,
      compliancePeriod: row.compliance_period,
      eligibleHolding: this.toSafeNumber(row.eligible_holding, 'eligible_holding'),
      lockedUnits: this.toSafeNumber(row.locked_units, 'locked_units'),
      surrenderedUnits: this.toSafeNumber(row.surrendered_units, 'surrendered_units'),
      reservedSell: this.toSafeNumber(row.reserved_sell, 'reserved_sell'),
      executedSellPending: this.toSafeNumber(row.executed_sell_pending, 'executed_sell_pending'),
      buyingCapacity: this.toSafeNumber(row.buying_capacity, 'buying_capacity'),
      reservedBuyFunds: this.toSafeNumber(row.reserved_buy_funds, 'reserved_buy_funds'),
      reservedBuyQuantity: this.toSafeNumber(row.reserved_buy_quantity, 'reserved_buy_quantity'),
      executedBuyPending: this.toSafeNumber(row.executed_buy_pending, 'executed_buy_pending'),
      executedBuyPendingFunds: this.toSafeNumber(
        row.executed_buy_pending_funds,
        'executed_buy_pending_funds',
      ),
      version: row.version,
    };
    return { position, balance };
  }

  private snapshotFromRow(row: PositionBalanceRow): PositionSnapshot {
    const { position, balance } = this.stateFromRow(row);
    return calculatePosition(position, balance);
  }

  private async releaseDbReservation(
    client: PoolClient,
    reservationId: string,
  ): Promise<BalanceReservation> {
    const reservationResult = await client.query<ReservationRow>(
      'SELECT * FROM balance_reservations WHERE reservation_id = $1 FOR UPDATE',
      [reservationId],
    );
    const row = reservationResult.rows[0];
    if (!row) throw new NotFoundException(`Reservation ${reservationId} was not found`);
    const reservation = this.mapReservation(row);
    if (reservation.status !== 'ACTIVE') return reservation;

    await client.query(
      `SELECT 1 FROM balance_accounts
       WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3
       FOR UPDATE`,
      [reservation.participantId, reservation.seriesCode, reservation.compliancePeriod],
    );
    if (reservation.kind === 'SELL_QUOTA') {
      await client.query(
        `UPDATE balance_accounts
         SET reserved_sell = reserved_sell - $4, version = version + 1, updated_at = now()
         WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3`,
        [
          reservation.participantId,
          reservation.seriesCode,
          reservation.compliancePeriod,
          reservation.remainingQuantity,
        ],
      );
    } else {
      await client.query(
        `UPDATE balance_accounts
         SET reserved_buy_funds = reserved_buy_funds - $4,
             reserved_buy_quantity = reserved_buy_quantity - $5,
             version = version + 1,
             updated_at = now()
         WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3`,
        [
          reservation.participantId,
          reservation.seriesCode,
          reservation.compliancePeriod,
          reservation.remainingAmount,
          reservation.remainingQuantity,
        ],
      );
    }

    const released = await client.query<ReservationRow>(
      `UPDATE balance_reservations
       SET status = 'RELEASED', remaining_quantity = 0, remaining_amount = 0, released_at = now()
       WHERE reservation_id = $1
       RETURNING *`,
      [reservationId],
    );
    return this.mapReservation(released.rows[0]!);
  }

  private async consumeDbReservation(
    client: PoolClient,
    reservationId: string,
    quantity: number,
    reservedAmount: number,
    executedAmount: number,
  ): Promise<BalanceReservation> {
    const reservationResult = await client.query<ReservationRow>(
      'SELECT * FROM balance_reservations WHERE reservation_id = $1 FOR UPDATE',
      [reservationId],
    );
    const row = reservationResult.rows[0];
    if (!row) throw new NotFoundException(`Reservation ${reservationId} was not found`);
    const reservation = this.mapReservation(row);
    this.assertConsumable(reservation, quantity, reservedAmount, executedAmount);

    await client.query(
      `SELECT 1 FROM balance_accounts
       WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3
       FOR UPDATE`,
      [reservation.participantId, reservation.seriesCode, reservation.compliancePeriod],
    );

    if (reservation.kind === 'SELL_QUOTA') {
      await client.query(
        `UPDATE balance_accounts
         SET reserved_sell = reserved_sell - $4,
             executed_sell_pending = executed_sell_pending + $4,
             version = version + 1,
             updated_at = now()
         WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3`,
        [reservation.participantId, reservation.seriesCode, reservation.compliancePeriod, quantity],
      );
    } else {
      await client.query(
        `UPDATE balance_accounts
         SET reserved_buy_funds = reserved_buy_funds - $4,
             reserved_buy_quantity = reserved_buy_quantity - $5,
             executed_buy_pending = executed_buy_pending + $5,
             executed_buy_pending_funds = executed_buy_pending_funds + $6,
             version = version + 1,
             updated_at = now()
         WHERE participant_id = $1 AND series_code = $2 AND compliance_period = $3`,
        [
          reservation.participantId,
          reservation.seriesCode,
          reservation.compliancePeriod,
          reservedAmount,
          quantity,
          executedAmount,
        ],
      );
    }

    const updated = await client.query<ReservationRow>(
      `UPDATE balance_reservations
       SET remaining_quantity = remaining_quantity - $2,
           remaining_amount = remaining_amount - $3,
           status = CASE WHEN remaining_quantity - $2 = 0 THEN 'CONSUMED' ELSE 'ACTIVE' END,
           consumed_at = CASE WHEN remaining_quantity - $2 = 0 THEN now() ELSE NULL END
       WHERE reservation_id = $1
       RETURNING *`,
      [reservationId, quantity, reservedAmount],
    );
    return this.mapReservation(updated.rows[0]!);
  }

  private async findExistingDbReservation(
    client: PoolClient,
    dto: CreateSellReservationDto,
    kind: BalanceReservation['kind'],
    quantity: number,
    amount: number,
  ): Promise<BalanceReservation | undefined> {
    const result = await client.query<ReservationRow>(
      `SELECT * FROM balance_reservations
       WHERE participant_id = $1 AND order_reference = $2 AND kind = $3`,
      [dto.participantId, dto.orderReference, kind],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const reservation = this.mapReservation(row);
    if (
      reservation.seriesCode !== dto.seriesCode ||
      reservation.compliancePeriod !== dto.compliancePeriod ||
      reservation.quantity !== quantity ||
      reservation.amount !== amount
    ) {
      throw this.idempotencyConflict();
    }
    if (reservation.status !== 'ACTIVE') {
      throw this.inactiveReservationConflict();
    }
    return reservation;
  }

  private async insertDbReservation(
    client: PoolClient,
    dto: CreateSellReservationDto,
    kind: BalanceReservation['kind'],
    quantity: number,
    amount: number,
  ): Promise<BalanceReservation> {
    const result = await client.query<ReservationRow>(
      `INSERT INTO balance_reservations (
         participant_id, series_code, compliance_period, order_reference, kind,
         quantity, amount, remaining_quantity, remaining_amount, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7, 'ACTIVE')
       RETURNING *`,
      [
        dto.participantId,
        dto.seriesCode,
        dto.compliancePeriod,
        dto.orderReference,
        kind,
        quantity,
        amount,
      ],
    );
    return this.mapReservation(result.rows[0]!);
  }

  private mapReservation(row: ReservationRow): BalanceReservation {
    return {
      reservationId: row.reservation_id,
      participantId: row.participant_id,
      seriesCode: row.series_code,
      compliancePeriod: row.compliance_period,
      orderReference: row.order_reference,
      kind: row.kind,
      quantity: this.toSafeNumber(row.quantity, 'quantity'),
      amount: this.toSafeNumber(row.amount, 'amount'),
      remainingQuantity: this.toSafeNumber(row.remaining_quantity, 'remaining_quantity'),
      remainingAmount: this.toSafeNumber(row.remaining_amount, 'remaining_amount'),
      status: row.status,
      createdAt: row.created_at.toISOString(),
      ...(row.released_at ? { releasedAt: row.released_at.toISOString() } : {}),
      ...(row.consumed_at ? { consumedAt: row.consumed_at.toISOString() } : {}),
    };
  }

  private createReservation(
    dto: CreateSellReservationDto,
    kind: BalanceReservation['kind'],
    quantity: number,
    amount: number,
  ): BalanceReservation {
    const reservation: BalanceReservation = {
      reservationId: randomUUID(),
      participantId: dto.participantId,
      seriesCode: dto.seriesCode,
      compliancePeriod: dto.compliancePeriod,
      orderReference: dto.orderReference,
      kind,
      quantity,
      amount,
      remainingQuantity: quantity,
      remainingAmount: amount,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    this.reservations.set(reservation.reservationId, reservation);
    return { ...reservation };
  }

  private findExistingReservation(
    dto: CreateSellReservationDto,
    kind: BalanceReservation['kind'],
    quantity: number,
    amount: number,
  ): BalanceReservation | undefined {
    const existing = [...this.reservations.values()].find(
      (reservation) =>
        reservation.participantId === dto.participantId &&
        reservation.orderReference === dto.orderReference &&
        reservation.kind === kind,
    );
    if (!existing) return undefined;
    if (
      existing.seriesCode !== dto.seriesCode ||
      existing.compliancePeriod !== dto.compliancePeriod ||
      existing.quantity !== quantity ||
      existing.amount !== amount
    ) {
      throw this.idempotencyConflict();
    }
    if (existing.status !== 'ACTIVE') {
      throw this.inactiveReservationConflict();
    }
    return { ...existing };
  }

  private snapshot(position: AnnualPositionInput): PositionSnapshot {
    const balance = this.requireBalance(
      position.participantId,
      position.seriesCode,
      position.compliancePeriod,
    );
    return calculatePosition(position, balance);
  }

  private requirePosition(
    participantId: string,
    seriesCode: string,
    compliancePeriod: number,
  ): AnnualPositionInput {
    const position = this.positions.get(this.key(participantId, seriesCode, compliancePeriod));
    if (!position) {
      throw new NotFoundException(
        `Position ${participantId}/${seriesCode}/${compliancePeriod} was not found`,
      );
    }
    return position;
  }

  private requireBalance(
    participantId: string,
    seriesCode: string,
    compliancePeriod: number,
  ): BalanceAccount {
    const balance = this.balances.get(this.key(participantId, seriesCode, compliancePeriod));
    if (!balance) {
      throw new NotFoundException(
        `Balance ${participantId}/${seriesCode}/${compliancePeriod} was not found`,
      );
    }
    return balance;
  }

  private assertConsumable(
    reservation: BalanceReservation,
    quantity: number,
    reservedAmount: number,
    executedAmount: number,
  ): void {
    if (reservation.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'BAL-RESERVATION-NOT-ACTIVE',
        message: 'Only an active reservation can be consumed',
      });
    }
    if (quantity > reservation.remainingQuantity || reservedAmount > reservation.remainingAmount) {
      throw new BadRequestException({
        code: 'BAL-RESERVATION-OVERCONSUME',
        message: 'Execution exceeds the remaining reservation',
      });
    }
    if (reservation.kind === 'SELL_QUOTA' && (reservedAmount !== 0 || executedAmount !== 0)) {
      throw new BadRequestException('Sell quota consumption cannot include cash amounts');
    }
    if (reservation.kind === 'BUY_FUNDS' && executedAmount > reservedAmount) {
      throw new BadRequestException({
        code: 'BAL-EXECUTION-ABOVE-RESERVATION',
        message: 'Executed notional exceeds the consumed reserved amount',
      });
    }
  }

  private assertBuyCapacity(quantity: number, amount: number, snapshot: PositionSnapshot): void {
    if (quantity > snapshot.availableBuyNeed) {
      throw new BadRequestException({
        code: 'BAL-BUY-NEED-EXCEEDED',
        message: 'Quantity exceeds remaining verified compliance need',
        availableBuyNeed: snapshot.availableBuyNeed,
      });
    }
    if (amount > snapshot.availableBuyingCapacity) {
      throw new BadRequestException({
        code: 'BAL-INSUFFICIENT-BUYING-CAPACITY',
        message: 'Maximum notional plus fee buffer exceeds available buying capacity',
        availableBuyingCapacity: snapshot.availableBuyingCapacity,
      });
    }
  }

  private insufficientSell(availableToSell: number): BadRequestException {
    return new BadRequestException({
      code: 'BAL-INSUFFICIENT-SELL-CAPACITY',
      message: 'Quantity exceeds available verified surplus or eligible holding',
      availableToSell,
    });
  }

  private idempotencyConflict(): BadRequestException {
    return new BadRequestException({
      code: 'BAL-IDEMPOTENCY-CONFLICT',
      message: 'Order reference was already used with a different reservation payload',
    });
  }

  private inactiveReservationConflict(): BadRequestException {
    return new BadRequestException({
      code: 'BAL-RESERVATION-NOT-ACTIVE',
      message: 'Order reference belongs to a reservation that is already terminal',
    });
  }

  private assertSafeMoney(value: number): void {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new BadRequestException({
        code: 'BAL-INVALID-NOTIONAL',
        message: 'Maximum notional plus fee buffer must be a positive safe integer',
      });
    }
  }

  private toSafeNumber(value: string, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${field} exceeds JavaScript safe integer range`);
    return parsed;
  }

  private key(participantId: string, seriesCode: string, compliancePeriod: number): string {
    return `${participantId}:${seriesCode}:${compliancePeriod}`;
  }
}
