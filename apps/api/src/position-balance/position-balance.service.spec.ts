import { BadRequestException } from '@nestjs/common';
import { PositionBalanceService } from './position-balance.service';

describe('PositionBalanceService', () => {
  let service: PositionBalanceService;

  beforeEach(() => {
    service = new PositionBalanceService();
  });

  it('prevents concurrent reservations from reusing the same sell capacity', async () => {
    const command = (suffix: string) =>
      service.reserveSell({
        participantId: 'IND-A',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        quantity: 20_000,
        orderReference: `ORDER-${suffix}`,
      });

    const results = await Promise.allSettled([command('1'), command('2')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await service.getPosition('IND-A', 'PTBAE-IND', 2027)).reservedSell).toBe(20_000);
  });

  it('releases a reservation idempotently', async () => {
    const reservation = await service.reserveSell({
      participantId: 'IND-A',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      quantity: 10_000,
      orderReference: 'ORDER-1',
    });

    await service.releaseReservation(reservation.reservationId);
    await service.releaseReservation(reservation.reservationId);

    expect((await service.getPosition('IND-A', 'PTBAE-IND', 2027)).reservedSell).toBe(0);
  });

  it('rejects buying beyond the verified need', async () => {
    await expect(
      service.reserveBuy({
        participantId: 'IND-D',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        quantity: 60_001,
        maximumNotional: 4_800_080_000,
        feeBuffer: 0,
        orderReference: 'ORDER-BUY-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents concurrent buy reservations from reusing the same compliance need', async () => {
    const command = (suffix: string) =>
      service.reserveBuy({
        participantId: 'IND-D',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        quantity: 40_000,
        maximumNotional: 3_200_000_000,
        feeBuffer: 0,
        orderReference: `ORDER-BUY-${suffix}`,
      });

    const results = await Promise.allSettled([command('1'), command('2')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await service.getPosition('IND-D', 'PTBAE-IND', 2027)).availableBuyNeed).toBe(20_000);
  });

  it('returns the original reservation for an idempotent retry', async () => {
    const command = {
      participantId: 'IND-A',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      quantity: 10_000,
      orderReference: 'ORDER-IDEMPOTENT',
    };

    const first = await service.reserveSell(command);
    const retry = await service.reserveSell(command);

    expect(retry.reservationId).toBe(first.reservationId);
    expect((await service.getPosition('IND-A', 'PTBAE-IND', 2027)).reservedSell).toBe(10_000);
  });

  it('does not reactivate a released reservation through an order-reference retry', async () => {
    const command = {
      participantId: 'IND-A',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      quantity: 10_000,
      orderReference: 'ORDER-TERMINAL',
    };
    const reservation = await service.reserveSell(command);
    await service.releaseReservation(reservation.reservationId);

    await expect(service.reserveSell(command)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BAL-RESERVATION-NOT-ACTIVE' }),
    });
    expect((await service.getPosition('IND-A', 'PTBAE-IND', 2027)).reservedSell).toBe(0);
  });
});
