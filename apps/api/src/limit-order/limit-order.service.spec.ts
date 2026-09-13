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

  it('executes the golden multi-seller scenario at resting prices', async () => {
    const ask75 = await service.submit(sell('IND-A', 'GOLDEN-ASK-75', 75_000, 30_000));
    const ask76 = await service.submit(sell('IND-B', 'GOLDEN-ASK-76', 76_000, 30_000));
    const ask78 = await service.submit(sell('IND-C', 'GOLDEN-ASK-78', 78_000, 30_000));

    const buy = await service.submit({
      ...sell('IND-D', 'GOLDEN-BUY-76', 76_000, 60_000),
      side: 'BUY',
    });

    const trades = await service.listTrades('PTBAE-IND', 2027);
    const book = await service.getOrderBook('PTBAE-IND', 2027);
    const buyerPosition = await positionService.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(trades.map(({ quantity, price }) => ({ quantity, price }))).toEqual([
      { quantity: 30_000, price: 75_000 },
      { quantity: 30_000, price: 76_000 },
    ]);
    expect(await service.getOrder(ask75.orderId)).toMatchObject({
      status: 'FILLED',
      remainingQuantity: 0,
    });
    expect(await service.getOrder(ask76.orderId)).toMatchObject({
      status: 'FILLED',
      remainingQuantity: 0,
    });
    expect(await service.getOrder(ask78.orderId)).toMatchObject({
      status: 'OPEN',
      remainingQuantity: 30_000,
    });
    expect(buy).toMatchObject({ status: 'FILLED', remainingQuantity: 0 });
    expect(book.asks).toEqual([{ price: 78_000, quantity: 30_000, orderCount: 1 }]);
    expect(buyerPosition).toMatchObject({
      reservedBuyFunds: 0,
      reservedBuyQuantity: 0,
      executedBuyPending: 60_000,
      executedBuyPendingFunds: 4_530_000_000,
      availableBuyNeed: 0,
    });
  });

  it('keeps a partially filled resting order in the visible book', async () => {
    const ask = await service.submit(sell('IND-A', 'PARTIAL-ASK', 75_000, 10_000));
    await service.submit({ ...sell('IND-D', 'PARTIAL-BUY', 75_000, 4_000), side: 'BUY' });

    expect(await service.getOrder(ask.orderId)).toMatchObject({
      status: 'PARTIALLY_FILLED',
      remainingQuantity: 6_000,
    });
    expect((await service.getOrderBook('PTBAE-IND', 2027)).asks).toEqual([
      { price: 75_000, quantity: 6_000, orderCount: 1 },
    ]);
  });

  it('releases only the unfilled reservation when a partial order is cancelled', async () => {
    const ask = await service.submit(sell('IND-A', 'PARTIAL-CANCEL-ASK', 75_000, 10_000));
    await service.submit({
      ...sell('IND-D', 'PARTIAL-CANCEL-BUY', 75_000, 4_000),
      side: 'BUY',
    });

    await service.cancel(ask.orderId);
    const sellerPosition = await positionService.getPosition('IND-A', 'PTBAE-IND', 2027);

    expect(sellerPosition).toMatchObject({
      reservedSell: 0,
      executedSellPending: 4_000,
      availableToSell: 26_000,
    });
  });

  it('does not match incompatible limit prices', async () => {
    await service.submit(sell('IND-A', 'NO-MATCH-ASK', 75_000, 5_000));
    await service.submit({ ...sell('IND-D', 'NO-MATCH-BID', 74_000, 5_000), side: 'BUY' });

    expect(await service.listTrades('PTBAE-IND', 2027)).toHaveLength(0);
  });

  it('keeps an incoming remainder after available liquidity is exhausted', async () => {
    await service.submit(sell('IND-A', 'INCOMING-PARTIAL-ASK', 75_000, 4_000));
    const buy = await service.submit({
      ...sell('IND-D', 'INCOMING-PARTIAL-BUY', 75_000, 10_000),
      side: 'BUY',
    });

    expect(buy).toMatchObject({ status: 'PARTIALLY_FILLED', remainingQuantity: 6_000 });
    expect((await service.getOrderBook('PTBAE-IND', 2027)).bids).toEqual([
      { price: 75_000, quantity: 6_000, orderCount: 1 },
    ]);
  });
});
