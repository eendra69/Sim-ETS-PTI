import { BadRequestException, Injectable } from '@nestjs/common';
import { LimitOrderService } from '../limit-order/limit-order.service';
import { Trade } from '../limit-order/limit-order.types';
import {
  MarketDataReplay,
  MarketDataSnapshot,
  MarketDataTradeEvent,
  TradeStatistics,
} from './market-data.types';

@Injectable()
export class MarketDataService {
  constructor(private readonly orderService: LimitOrderService) {}

  async getSnapshot(
    seriesCode: string,
    compliancePeriod: number,
    fromTradeSequence?: number,
    toTradeSequence?: number,
  ): Promise<MarketDataSnapshot> {
    this.assertWindow(fromTradeSequence, toTradeSequence);
    this.assertMarket(seriesCode, compliancePeriod);
    const [allTrades, book] = await Promise.all([
      this.orderService.listTrades(seriesCode, compliancePeriod),
      this.orderService.getOrderBook(seriesCode, compliancePeriod),
    ]);
    const selectedTrades = this.selectTrades(allTrades, fromTradeSequence, toTradeSequence);
    const lastTrade = allTrades.at(-1) ?? null;
    const bestBid = book.bids[0] ?? null;
    const bestAsk = book.asks[0] ?? null;
    const ruleset = this.orderService.getRuleset();

    return {
      seriesCode,
      compliancePeriod,
      sessionId: ruleset.marketSessionId,
      rulesetId: ruleset.rulesetId,
      state: lastTrade ? 'TRADING' : 'NO_TRADES',
      referencePrice: ruleset.referencePrice,
      lastTradedPrice: lastTrade?.price ?? null,
      lastTrade,
      topOfBook: {
        bestBid,
        bestAsk,
        spread: bestBid && bestAsk ? bestAsk.price - bestBid.price : null,
      },
      depth: { bids: book.bids, asks: book.asks },
      statisticsWindow: {
        fromTradeSequence: fromTradeSequence ?? null,
        toTradeSequence: toTradeSequence ?? null,
      },
      statistics: this.calculateStatistics(selectedTrades),
      generatedAt: new Date().toISOString(),
    };
  }

  async listEvents(
    seriesCode: string,
    compliancePeriod: number,
    afterTradeSequence = 0,
    limit = 100,
  ): Promise<MarketDataTradeEvent[]> {
    this.assertMarket(seriesCode, compliancePeriod);
    const sessionId = this.orderService.getRuleset().marketSessionId;
    return (await this.orderService.listTrades(seriesCode, compliancePeriod))
      .filter((trade) => trade.tradeSequence > afterTradeSequence)
      .slice(0, limit)
      .map((trade) => this.toEvent(trade, sessionId));
  }

  async replay(
    seriesCode: string,
    compliancePeriod: number,
    fromTradeSequence?: number,
    toTradeSequence?: number,
  ): Promise<MarketDataReplay> {
    this.assertWindow(fromTradeSequence, toTradeSequence);
    this.assertMarket(seriesCode, compliancePeriod);
    const sessionId = this.orderService.getRuleset().marketSessionId;
    const trades = this.selectTrades(
      await this.orderService.listTrades(seriesCode, compliancePeriod),
      fromTradeSequence,
      toTradeSequence,
    );
    let rolling = this.emptyStatistics();
    return {
      seriesCode,
      compliancePeriod,
      sessionId,
      points: trades.map((trade) => {
        rolling = this.appendTrade(rolling, trade);
        return {
          event: this.toEvent(trade, sessionId),
          stateAfterEvent: {
            lastTradedPrice: trade.price,
            statistics: { ...rolling },
          },
        };
      }),
      finalStatistics: this.calculateStatistics(trades),
    };
  }

  calculateStatistics(trades: Trade[]): TradeStatistics {
    return trades.reduce(
      (statistics, trade) => this.appendTrade(statistics, trade),
      this.emptyStatistics(),
    );
  }

  private emptyStatistics(): TradeStatistics {
    return {
      tradeCount: 0,
      volume: 0,
      notional: 0,
      vwap: null,
      open: null,
      high: null,
      low: null,
      close: null,
    };
  }

  private appendTrade(statistics: TradeStatistics, trade: Trade): TradeStatistics {
    const volume = statistics.volume + trade.quantity;
    const notional = statistics.notional + trade.notional;
    if (!Number.isSafeInteger(volume) || !Number.isSafeInteger(notional)) {
      throw new BadRequestException({
        code: 'MD-AGGREGATE-OVERFLOW',
        message: 'Market-data aggregate exceeds the supported safe integer range',
      });
    }
    return {
      tradeCount: statistics.tradeCount + 1,
      volume,
      notional,
      vwap: notional / volume,
      open: statistics.open ?? trade.price,
      high: statistics.high === null ? trade.price : Math.max(statistics.high, trade.price),
      low: statistics.low === null ? trade.price : Math.min(statistics.low, trade.price),
      close: trade.price,
    };
  }

  private selectTrades(
    trades: Trade[],
    fromTradeSequence?: number,
    toTradeSequence?: number,
  ): Trade[] {
    return trades.filter(
      (trade) =>
        (fromTradeSequence === undefined || trade.tradeSequence >= fromTradeSequence) &&
        (toTradeSequence === undefined || trade.tradeSequence <= toTradeSequence),
    );
  }

  private assertWindow(fromTradeSequence?: number, toTradeSequence?: number): void {
    if (
      fromTradeSequence !== undefined &&
      toTradeSequence !== undefined &&
      fromTradeSequence > toTradeSequence
    ) {
      throw new BadRequestException({
        code: 'MD-INVALID-WINDOW',
        message: 'fromTradeSequence must not exceed toTradeSequence',
      });
    }
  }

  private assertMarket(seriesCode: string, compliancePeriod: number): void {
    const ruleset = this.orderService.getRuleset();
    if (seriesCode !== ruleset.seriesCode || compliancePeriod !== ruleset.compliancePeriod) {
      throw new BadRequestException({
        code: 'MD-UNSUPPORTED-MARKET',
        message: 'No active market-data session exists for the requested series and period',
      });
    }
  }

  private toEvent(trade: Trade, sessionId: string): MarketDataTradeEvent {
    return {
      eventId: `TRADE:${trade.tradeId}`,
      eventType: 'TRADE',
      eventSequence: trade.tradeSequence,
      sessionId,
      occurredAt: trade.executedAt,
      trade,
    };
  }
}
