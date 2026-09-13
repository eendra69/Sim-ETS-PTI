import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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

@Injectable()
export class PositionBalanceService {
  private readonly positions = new Map<string, AnnualPositionInput>();
  private readonly balances = new Map<string, BalanceAccount>();
  private readonly reservations = new Map<string, BalanceReservation>();
  private readonly mutex = new KeyedMutex();

  constructor() {
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

  listPositions(seriesCode: string, compliancePeriod: number): PositionSnapshot[] {
    return [...this.positions.values()]
      .filter(
        (position) =>
          position.seriesCode === seriesCode && position.compliancePeriod === compliancePeriod,
      )
      .map((position) => this.snapshot(position))
      .sort((left, right) => left.participantId.localeCompare(right.participantId));
  }

  getPosition(
    participantId: string,
    seriesCode: string,
    compliancePeriod: number,
  ): PositionSnapshot {
    const position = this.requirePosition(participantId, seriesCode, compliancePeriod);
    return this.snapshot(position);
  }

  async reserveSell(dto: CreateSellReservationDto): Promise<BalanceReservation> {
    const key = this.key(dto.participantId, dto.seriesCode, dto.compliancePeriod);
    return this.mutex.runExclusive(key, () => {
      const existing = this.findExistingReservation(dto, 'SELL_QUOTA', dto.quantity, 0);
      if (existing) return existing;

      const position = this.requirePosition(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const balance = this.requireBalance(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const snapshot = calculatePosition(position, balance);
      if (dto.quantity > snapshot.availableToSell) {
        throw new BadRequestException({
          code: 'BAL-INSUFFICIENT-SELL-CAPACITY',
          message: 'Quantity exceeds available verified surplus or eligible holding',
          availableToSell: snapshot.availableToSell,
        });
      }

      balance.reservedSell += dto.quantity;
      balance.version += 1;
      return this.createReservation(dto, 'SELL_QUOTA', dto.quantity, 0);
    });
  }

  async reserveBuy(dto: CreateBuyReservationDto): Promise<BalanceReservation> {
    const key = this.key(dto.participantId, dto.seriesCode, dto.compliancePeriod);
    return this.mutex.runExclusive(key, () => {
      const amount = dto.maximumNotional + dto.feeBuffer;
      const existing = this.findExistingReservation(dto, 'BUY_FUNDS', dto.quantity, amount);
      if (existing) return existing;

      const position = this.requirePosition(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const balance = this.requireBalance(dto.participantId, dto.seriesCode, dto.compliancePeriod);
      const snapshot = calculatePosition(position, balance);

      if (dto.quantity > snapshot.availableBuyNeed) {
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

      balance.reservedBuyFunds += amount;
      balance.reservedBuyQuantity += dto.quantity;
      balance.version += 1;
      return this.createReservation(dto, 'BUY_FUNDS', dto.quantity, amount);
    });
  }

  async releaseReservation(reservationId: string): Promise<BalanceReservation> {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new NotFoundException(`Reservation ${reservationId} was not found`);
    }
    const key = this.key(
      reservation.participantId,
      reservation.seriesCode,
      reservation.compliancePeriod,
    );

    return this.mutex.runExclusive(key, () => {
      if (reservation.status === 'RELEASED') {
        return { ...reservation };
      }
      const balance = this.requireBalance(
        reservation.participantId,
        reservation.seriesCode,
        reservation.compliancePeriod,
      );
      if (reservation.kind === 'SELL_QUOTA') {
        balance.reservedSell -= reservation.quantity;
      } else {
        balance.reservedBuyFunds -= reservation.amount;
        balance.reservedBuyQuantity -= reservation.quantity;
      }
      balance.version += 1;
      reservation.status = 'RELEASED';
      reservation.releasedAt = new Date().toISOString();
      return { ...reservation };
    });
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
        reservation.seriesCode === dto.seriesCode &&
        reservation.compliancePeriod === dto.compliancePeriod &&
        reservation.orderReference === dto.orderReference &&
        reservation.kind === kind,
    );
    if (!existing) return undefined;
    if (existing.quantity !== quantity || existing.amount !== amount) {
      throw new BadRequestException({
        code: 'BAL-IDEMPOTENCY-CONFLICT',
        message: 'Order reference was already used with a different reservation payload',
      });
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

  private key(participantId: string, seriesCode: string, compliancePeriod: number): string {
    return `${participantId}:${seriesCode}:${compliancePeriod}`;
  }
}
