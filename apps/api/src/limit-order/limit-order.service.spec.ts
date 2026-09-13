import { BadRequestException } from '@nestjs/common';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { CreateLimitOrderDto } from './dto/create-limit-order.dto';
import { LimitOrderService } from './limit-order.service';

describe('LimitOrderService', () => {
  let positionService: PositionBalanceService;
  let service: LimitOrderService;

  beforeEach(() => {
    positionService = new PositionBalanceService();
    service = new LimitOrderService(positionService);
  });

  const sell = (
    participantId: string,
    clientOrderId: string,
    limitPrice: number,
    quantity = 5_000,
  ): CreateLimitOrderDto => ({
    participantId,
    clientOrderId,
    seriesCode: 'PTBAE-IND',
    compliancePeriod: 2027,
    side: 'SELL',
    orderType: 'LIMIT',
    quantity,
    limitPrice,
    timeInForce: 'DAY',
  });

  it('sorts asks by price, then FIFO within the same price', async () => {
    const firstAtPrice = await service.submit(sell('IND-A', 'ASK-A', 70_000));
    const secondAtPrice = await service.submit(sell('IND-B', 'ASK-B', 70_000));
    const bestPrice = await service.submit(sell('IND-C', 'ASK-C', 68_000));

    const book = await service.getOrderBook('PTBAE-IND', 2027);

    expect(book.orders.asks.map((order) => order.orderId)).toEqual([
      bestPrice.orderId,
      firstAtPrice.orderId,
      secondAtPrice.orderId,
    ]);
    expect(book.asks).toEqual([
      { price: 68_000, quantity: 5_000, orderCount: 1 },
      { price: 70_000, quantity: 10_000, orderCount: 2 },
    ]);
  });

  it('sorts bids from highest price and reserves the maximum notional', async () => {
    await service.submit({ ...sell('IND-D', 'BID-LOW', 72_000), side: 'BUY' });
    const best = await service.submit({ ...sell('IND-D', 'BID-HIGH', 76_000), side: 'BUY' });

    const book = await service.getOrderBook('PTBAE-IND', 2027);
    const position = await positionService.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(book.orders.bids[0]?.orderId).toBe(best.orderId);
    expect(position.reservedBuyFunds).toBe(740_000_000);
    expect(position.reservedBuyQuantity).toBe(10_000);
  });

  it('releases capacity and removes an order from the book on cancellation', async () => {
    const order = await service.submit(sell('IND-A', 'ASK-CANCEL', 70_000, 10_000));

    const cancelled = await service.cancel(order.orderId);
    const retry = await service.cancel(order.orderId);
    const position = await positionService.getPosition('IND-A', 'PTBAE-IND', 2027);
    const book = await service.getOrderBook('PTBAE-IND', 2027);

    expect(cancelled.status).toBe('CANCELLED');
    expect(retry.status).toBe('CANCELLED');
    expect(position.reservedSell).toBe(0);
    expect(book.orders.asks).toHaveLength(0);
  });

  it('returns the same order for an idempotent retry', async () => {
    const command = sell('IND-A', 'ASK-IDEMPOTENT', 70_000);
    const first = await service.submit(command);
    const retry = await service.submit(command);

    expect(retry.orderId).toBe(first.orderId);
    expect((await positionService.getPosition('IND-A', 'PTBAE-IND', 2027)).reservedSell).toBe(5_000);
  });

  it('rejects a reused client order ID with a changed payload', async () => {
    await service.submit(sell('IND-A', 'ASK-CONFLICT', 70_000));

    await expect(service.submit(sell('IND-A', 'ASK-CONFLICT', 70_200))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORD-IDEMPOTENCY-CONFLICT' }),
    });
  });

  it.each([
    [59_800, 'ORD-PRICE-OUTSIDE-BAND'],
    [70_100, 'ORD-INVALID-TICK'],
  ])('rejects invalid limit price %i', async (limitPrice, code) => {
    await expect(service.submit(sell('IND-A', `ASK-${limitPrice}`, limitPrice))).rejects.toEqual(
      expect.any(BadRequestException),
    );
    await expect(service.submit(sell('IND-A', `ASK-${limitPrice}-2`, limitPrice))).rejects.toMatchObject({
      response: expect.objectContaining({ code }),
    });
  });

  it('expires DAY orders but leaves GTC orders open', async () => {
    const day = await service.submit(sell('IND-A', 'ASK-DAY', 70_000));
    const gtc = await service.submit({ ...sell('IND-B', 'ASK-GTC', 71_000), timeInForce: 'GTC' });

    const expired = await service.expireDayOrders('PTBAE-IND', 2027);
    const book = await service.getOrderBook('PTBAE-IND', 2027);

    expect(expired.map((order) => order.orderId)).toEqual([day.orderId]);
    expect(book.orders.asks.map((order) => order.orderId)).toEqual([gtc.orderId]);
  });

  it('rejects another compliance period before reserving balance', async () => {
    await expect(
      service.submit({ ...sell('IND-A', 'ASK-WRONG-PERIOD', 70_000), compliancePeriod: 2028 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORD-UNSUPPORTED-MARKET' }),
    });

    expect((await positionService.getPosition('IND-A', 'PTBAE-IND', 2027)).reservedSell).toBe(0);
  });
});
