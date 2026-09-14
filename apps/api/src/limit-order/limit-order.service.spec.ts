import { BadRequestException } from '@nestjs/common';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { CreateOrderDto } from './dto/create-order.dto';
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
  ): CreateOrderDto => ({
    participantId,
    installationId: `INST-${participantId.slice(-1)}-01`,
    vintageYear: 2027,
    clientOrderId,
    seriesCode: 'PTBAE-IND',
    compliancePeriod: 2027,
    side: 'SELL',
    orderType: 'LIMIT',
    quantity,
    limitPrice,
    timeInForce: 'DAY',
  });

  const market = (
    participantId: string,
    clientOrderId: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    protectionPrice: number,
  ): CreateOrderDto => ({
    participantId,
    installationId: `INST-${participantId.slice(-1)}-01`,
    vintageYear: 2027,
    clientOrderId,
    seriesCode: 'PTBAE-IND',
    compliancePeriod: 2027,
    side,
    orderType: 'MARKET',
    quantity,
    protectionPrice,
    timeInForce: 'IOC',
  });

  const stop = (
    participantId: string,
    clientOrderId: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    stopPrice: number,
    protectionPrice: number,
  ): CreateOrderDto => ({
    participantId,
    installationId: `INST-${participantId.slice(-1)}-01`,
    vintageYear: 2027,
    clientOrderId,
    seriesCode: 'PTBAE-IND',
    compliancePeriod: 2027,
    side,
    orderType: 'STOP',
    quantity,
    stopPrice,
    protectionPrice,
    triggerBasis: 'LTP',
    activationType: 'MARKET',
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

  it('isolates order books and trades by vintage', async () => {
    await service.submit({ ...sell('IND-A', 'ASK-V2024', 70_000), vintageYear: 2024 });
    const differentVintage = await service.submit({
      ...sell('IND-D', 'BID-V2025', 70_000),
      side: 'BUY',
      vintageYear: 2025,
    });

    expect(differentVintage.status).toBe('OPEN');
    expect((await service.getOrderBook('PTBAE-IND', 2027, 2024)).asks).toHaveLength(1);
    expect((await service.getOrderBook('PTBAE-IND', 2027, 2024)).bids).toHaveLength(0);
    expect((await service.getOrderBook('PTBAE-IND', 2027, 2025)).bids).toHaveLength(1);

    const sameVintage = await service.submit({
      ...sell('IND-D', 'BID-V2024', 70_000),
      side: 'BUY',
      vintageYear: 2024,
    });
    expect(sameVintage.status).toBe('FILLED');
    await expect(service.listTrades('PTBAE-IND', 2027, 2024)).resolves.toEqual([
      expect.objectContaining({ vintageYear: 2024 }),
    ]);
    await expect(service.listTrades('PTBAE-IND', 2027, 2025)).resolves.toEqual([]);
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

  it('sweeps multiple price levels with a protected BUY MARKET order', async () => {
    await service.submit(sell('IND-A', 'MARKET-ASK-75', 75_000, 30_000));
    await service.submit(sell('IND-B', 'MARKET-ASK-76', 76_000, 20_000));
    await service.submit(sell('IND-C', 'MARKET-ASK-78', 78_000, 10_000));

    const buy = await service.submit(market('IND-D', 'MARKET-BUY-FULL', 'BUY', 60_000, 90_000));
    const trades = await service.listTrades('PTBAE-IND', 2027);

    expect(buy).toMatchObject({ status: 'FILLED', remainingQuantity: 0 });
    expect(trades.map(({ quantity, price }) => ({ quantity, price }))).toEqual([
      { quantity: 30_000, price: 75_000 },
      { quantity: 20_000, price: 76_000 },
      { quantity: 10_000, price: 78_000 },
    ]);
    expect(await positionService.getPosition('IND-D', 'PTBAE-IND', 2027)).toMatchObject({
      reservedBuyFunds: 0,
      executedBuyPending: 60_000,
      executedBuyPendingFunds: 4_550_000_000,
      availableBuyNeed: 0,
    });
  });

  it('cancels a BUY MARKET remainder when protection is reached', async () => {
    await service.submit(sell('IND-A', 'PROTECTED-ASK-75', 75_000, 30_000));
    await service.submit(sell('IND-B', 'PROTECTED-ASK-76', 76_000, 20_000));
    await service.submit(sell('IND-C', 'PROTECTED-ASK-78', 78_000, 10_000));

    const buy = await service.submit(
      market('IND-D', 'PROTECTED-BUY-MARKET', 'BUY', 60_000, 76_000),
    );
    const position = await positionService.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(buy).toMatchObject({ status: 'CANCELLED_REMAINDER', remainingQuantity: 10_000 });
    expect((await service.listTrades('PTBAE-IND', 2027)).map((trade) => trade.price)).toEqual([
      75_000,
      76_000,
    ]);
    expect((await service.getOrderBook('PTBAE-IND', 2027)).asks).toEqual([
      { price: 78_000, quantity: 10_000, orderCount: 1 },
    ]);
    expect(position).toMatchObject({
      reservedBuyFunds: 0,
      reservedBuyQuantity: 0,
      executedBuyPending: 50_000,
      executedBuyPendingFunds: 3_770_000_000,
      availableBuyNeed: 10_000,
    });
  });

  it('cancels an empty-book MARKET order without retaining a reservation', async () => {
    const order = await service.submit(
      market('IND-D', 'EMPTY-MARKET', 'BUY', 10_000, 76_000),
    );
    const retry = await service.submit(
      market('IND-D', 'EMPTY-MARKET', 'BUY', 10_000, 76_000),
    );
    const position = await positionService.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(order).toMatchObject({ status: 'CANCELLED_REMAINDER', remainingQuantity: 10_000 });
    expect(retry.orderId).toBe(order.orderId);
    expect(position).toMatchObject({ reservedBuyFunds: 0, reservedBuyQuantity: 0 });
  });

  it('executes a protected SELL MARKET against the highest resting bid', async () => {
    await service.submit({ ...sell('IND-D', 'MARKET-BID-76', 76_000, 20_000), side: 'BUY' });

    const sellMarket = await service.submit(
      market('IND-A', 'MARKET-SELL-FULL', 'SELL', 20_000, 75_000),
    );
    const trades = await service.listTrades('PTBAE-IND', 2027);

    expect(sellMarket.status).toBe('FILLED');
    expect(trades).toEqual([
      expect.objectContaining({ quantity: 20_000, price: 76_000 }),
    ]);
  });

  it('rejects invalid MARKET and LIMIT field combinations', async () => {
    await expect(
      service.submit({
        ...market('IND-D', 'MARKET-WITH-LIMIT', 'BUY', 10_000, 76_000),
        limitPrice: 75_000,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORD-INVALID-MARKET-FIELDS' }),
    });
    await expect(
      service.submit({ ...sell('IND-A', 'LIMIT-WITH-IOC', 75_000), timeInForce: 'IOC' }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORD-INVALID-LIMIT-FIELDS' }),
    });
  });

  it('keeps STOP liquidity non-visible while reserving capacity at submission', async () => {
    const order = await service.submit(stop('IND-D', 'PENDING-STOP', 'BUY', 5_000, 78_000, 80_000));
    const retry = await service.submit(stop('IND-D', 'PENDING-STOP', 'BUY', 5_000, 78_000, 80_000));
    const position = await positionService.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(order).toMatchObject({ orderType: 'STOP', status: 'TRIGGER_PENDING' });
    expect(retry.orderId).toBe(order.orderId);
    expect((await service.getTriggerBook('PTBAE-IND', 2027)).entries).toHaveLength(1);
    expect((await service.getOrderBook('PTBAE-IND', 2027)).bids).toEqual([]);
    expect(position).toMatchObject({ reservedBuyQuantity: 5_000, reservedBuyFunds: 400_000_000 });
  });

  it('leaves a BUY STOP pending below its LTP threshold', async () => {
    const stopOrder = await service.submit(
      stop('IND-D', 'BELOW-TRIGGER', 'BUY', 5_000, 78_000, 80_000),
    );
    await service.submit(sell('IND-A', 'BELOW-SOURCE-ASK', 76_000, 1_000));
    await service.submit({ ...sell('IND-D', 'BELOW-SOURCE-BUY', 76_000, 1_000), side: 'BUY' });

    expect(await service.getOrder(stopOrder.orderId)).toMatchObject({ status: 'TRIGGER_PENDING' });
    expect(await service.listTriggerEvents('PTBAE-IND', 2027)).toEqual([]);
  });

  it('activates a BUY STOP exactly once at the LTP threshold and preserves its ID chain', async () => {
    const stopOrder = await service.submit(
      stop('IND-D', 'EXACT-TRIGGER', 'BUY', 5_000, 78_000, 80_000),
    );
    await service.submit(sell('IND-A', 'EXACT-SOURCE-ASK', 78_000, 1_000));
    await service.submit(sell('IND-B', 'EXACT-ACTIVATION-ASK', 78_000, 5_000));
    await service.submit({ ...sell('IND-D', 'EXACT-SOURCE-BUY', 78_000, 1_000), side: 'BUY' });

    const updated = await service.getOrder(stopOrder.orderId);
    const events = await service.listTriggerEvents('PTBAE-IND', 2027);
    const sourceTrade = (await service.listTrades('PTBAE-IND', 2027))[0]!;

    expect(updated).toMatchObject({ status: 'ACTIVATED' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      stopOrderId: stopOrder.orderId,
      sourceTradeId: sourceTrade.tradeId,
      observedLtp: 78_000,
      activatedOrderId: (updated as { activatedOrderId: string }).activatedOrderId,
    });
    expect(events[0]!.activatedTradeIds).toHaveLength(1);
    expect(await service.evaluateTriggersForTrade(sourceTrade.tradeId)).toEqual([]);
    expect(await service.listTriggerEvents('PTBAE-IND', 2027)).toHaveLength(1);
  });

  it('activates a SELL STOP when LTP is at or below the stop price', async () => {
    const stopOrder = await service.submit(
      stop('IND-A', 'SELL-TRIGGER', 'SELL', 5_000, 74_000, 70_000),
    );
    await service.submit({ ...sell('IND-D', 'SELL-TRIGGER-BID', 74_000, 6_000), side: 'BUY' });
    await service.submit(sell('IND-B', 'SELL-TRIGGER-SOURCE', 74_000, 1_000));

    expect(await service.getOrder(stopOrder.orderId)).toMatchObject({ status: 'ACTIVATED' });
    expect((await service.listTrades('PTBAE-IND', 2027)).map((trade) => trade.quantity)).toEqual([
      1_000,
      5_000,
    ]);
  });

  it('cancels a pending STOP and releases its reservation before activation', async () => {
    const order = await service.submit(
      stop('IND-D', 'CANCEL-PENDING-STOP', 'BUY', 5_000, 78_000, 80_000),
    );
    const cancelled = await service.cancel(order.orderId);
    const position = await positionService.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(cancelled.status).toBe('CANCELLED');
    expect((await service.getTriggerBook('PTBAE-IND', 2027)).entries).toEqual([]);
    expect(position).toMatchObject({ reservedBuyQuantity: 0, reservedBuyFunds: 0 });
  });

  it('expires a DAY STOP before trigger and prevents later activation', async () => {
    const order = await service.submit(
      stop('IND-D', 'EXPIRE-PENDING-STOP', 'BUY', 5_000, 78_000, 80_000),
    );
    const expired = await service.expireDayOrders('PTBAE-IND', 2027);

    expect(expired).toEqual([expect.objectContaining({ orderId: order.orderId, status: 'EXPIRED' })]);
    expect((await service.getTriggerBook('PTBAE-IND', 2027)).entries).toEqual([]);
    expect(await positionService.getPosition('IND-D', 'PTBAE-IND', 2027)).toMatchObject({
      reservedBuyQuantity: 0,
      reservedBuyFunds: 0,
    });
  });

  it('activates on a gap but does not trade outside STOP protection', async () => {
    const stopOrder = await service.submit(
      stop('IND-D', 'GAP-STOP', 'BUY', 5_000, 78_000, 78_000),
    );
    await service.submit(sell('IND-A', 'GAP-SOURCE-ASK', 80_000, 1_000));
    await service.submit(sell('IND-B', 'GAP-ACTIVATION-ASK', 80_000, 5_000));
    await service.submit({ ...sell('IND-D', 'GAP-SOURCE-BUY', 80_000, 1_000), side: 'BUY' });

    const updated = await service.getOrder(stopOrder.orderId);
    const event = (await service.listTriggerEvents('PTBAE-IND', 2027))[0]!;
    const activated = await service.getOrder(
      (updated as { activatedOrderId: string }).activatedOrderId,
    );

    expect(updated.status).toBe('ACTIVATED');
    expect(activated).toMatchObject({ status: 'CANCELLED_REMAINDER', remainingQuantity: 5_000 });
    expect(event).toMatchObject({ observedLtp: 80_000, activatedTradeIds: [] });
    expect((await service.listTrades('PTBAE-IND', 2027))).toHaveLength(1);
  });

  it('rejects incomplete STOP field combinations', async () => {
    await expect(
      service.submit({
        ...stop('IND-D', 'INVALID-STOP', 'BUY', 5_000, 78_000, 80_000),
        triggerBasis: undefined,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORD-INVALID-STOP-FIELDS' }),
    });
    await expect(
      service.submit(stop('IND-D', 'INVALID-STOP-PROTECTION', 'BUY', 5_000, 78_000, 76_000)),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ORD-INVALID-STOP-PROTECTION' }),
    });
  });
});
