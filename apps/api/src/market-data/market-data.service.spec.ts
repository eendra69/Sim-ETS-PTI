import { LimitOrderService } from '../limit-order/limit-order.service';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { MarketDataService } from './market-data.service';

describe('MarketDataService', () => {
  let positions: PositionBalanceService;
  let orders: LimitOrderService;
  let marketData: MarketDataService;

  beforeEach(() => {
    positions = new PositionBalanceService();
    orders = new LimitOrderService(positions);
    marketData = new MarketDataService(orders);
  });

  const limit = (
    participantId: string,
    clientOrderId: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    limitPrice: number,
  ) =>
    orders.submit({
      participantId,
      installationId: `INST-${participantId.slice(-1)}-01`,
      vintageYear: 2027,
      clientOrderId,
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side,
      orderType: 'LIMIT',
      quantity,
      limitPrice,
      timeInForce: 'DAY',
    });

  async function createThreeTrades(): Promise<void> {
    await limit('IND-A', 'MD-ASK-75', 'SELL', 30_000, 75_000);
    await limit('IND-B', 'MD-ASK-76', 'SELL', 20_000, 76_000);
    await limit('IND-C', 'MD-ASK-78', 'SELL', 10_000, 78_000);
    await orders.submit({
      participantId: 'IND-D',
      installationId: 'INST-D-01',
      vintageYear: 2027,
      clientOrderId: 'MD-MARKET-BUY',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 60_000,
      protectionPrice: 90_000,
      timeInForce: 'IOC',
    });
  }

  it('keeps reference price separate from an explicit no-trade state', async () => {
    await orders.submit({
      participantId: 'IND-D',
      installationId: 'INST-D-01',
      vintageYear: 2027,
      clientOrderId: 'MD-HIDDEN-STOP',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side: 'BUY',
      orderType: 'STOP',
      quantity: 1_000,
      stopPrice: 78_000,
      protectionPrice: 80_000,
      triggerBasis: 'LTP',
      activationType: 'MARKET',
      timeInForce: 'GTC',
    });
    await limit('IND-D', 'MD-BID', 'BUY', 1_000, 74_000);
    await limit('IND-A', 'MD-ASK', 'SELL', 1_000, 76_000);

    const snapshot = await marketData.getSnapshot('PTBAE-IND', 2027);

    expect(snapshot).toMatchObject({
      state: 'NO_TRADES',
      referencePrice: 75_000,
      lastTradedPrice: null,
      lastTrade: null,
      topOfBook: {
        bestBid: { price: 74_000, quantity: 1_000, orderCount: 1 },
        bestAsk: { price: 76_000, quantity: 1_000, orderCount: 1 },
        spread: 2_000,
      },
      statistics: {
        tradeCount: 0,
        volume: 0,
        notional: 0,
        vwap: null,
        open: null,
        high: null,
        low: null,
        close: null,
      },
    });
    expect(snapshot.depth.bids).toHaveLength(1);
    expect(snapshot.depth.asks).toHaveLength(1);
  });

  it('calculates LTP, VWAP, OHLCV, volume, and immutable trade legs', async () => {
    await createThreeTrades();

    const snapshot = await marketData.getSnapshot('PTBAE-IND', 2027);
    const trades = await orders.listTrades('PTBAE-IND', 2027);

    expect(snapshot).toMatchObject({
      state: 'TRADING',
      lastTradedPrice: 78_000,
      statistics: {
        tradeCount: 3,
        volume: 60_000,
        notional: 4_550_000_000,
        vwap: 4_550_000_000 / 60_000,
        open: 75_000,
        high: 78_000,
        low: 75_000,
        close: 78_000,
      },
    });
    expect(trades[0]!.legs).toEqual([
      expect.objectContaining({ side: 'BUY', unitDelta: 30_000, cashDelta: -2_250_000_000 }),
      expect.objectContaining({ side: 'SELL', unitDelta: -30_000, cashDelta: 2_250_000_000 }),
    ]);
  });

  it('calculates a bounded trade-sequence window independently from current LTP', async () => {
    await createThreeTrades();

    const snapshot = await marketData.getSnapshot('PTBAE-IND', 2027, 2, 3);

    expect(snapshot.lastTradedPrice).toBe(78_000);
    expect(snapshot.statisticsWindow).toEqual({ fromTradeSequence: 2, toTradeSequence: 3 });
    expect(snapshot.statistics).toMatchObject({
      tradeCount: 2,
      volume: 30_000,
      notional: 2_300_000_000,
      vwap: 2_300_000_000 / 30_000,
      open: 76_000,
      high: 78_000,
      low: 76_000,
      close: 78_000,
    });
  });

  it('replays immutable trade events into the same final statistics', async () => {
    await createThreeTrades();

    const replay = await marketData.replay('PTBAE-IND', 2027);
    const snapshot = await marketData.getSnapshot('PTBAE-IND', 2027);

    expect(replay.points.map((point) => point.event.eventSequence)).toEqual([1, 2, 3]);
    expect(replay.points.map((point) => point.stateAfterEvent.lastTradedPrice)).toEqual([
      75_000,
      76_000,
      78_000,
    ]);
    expect(replay.finalStatistics).toEqual(snapshot.statistics);
  });

  it('provides a resumable ordered event feed', async () => {
    await createThreeTrades();

    const events = await marketData.listEvents('PTBAE-IND', 2027, 1, 1);

    expect(events).toEqual([
      expect.objectContaining({ eventType: 'TRADE', eventSequence: 2 }),
    ]);
  });

  it('rejects an inverted statistics window', async () => {
    await expect(marketData.getSnapshot('PTBAE-IND', 2027, 3, 2)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MD-INVALID-WINDOW' }),
    });
  });
});
