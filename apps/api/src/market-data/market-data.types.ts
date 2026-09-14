import { OrderBookLevel, Trade } from '../limit-order/limit-order.types';

export interface TradeStatistics {
  tradeCount: number;
  volume: number;
  notional: number;
  vwap: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

export interface MarketDataSnapshot {
  seriesCode: string;
  compliancePeriod: number;
  vintageYear?: number;
  sessionId: string;
  rulesetId: string;
  state: 'NO_TRADES' | 'TRADING';
  referencePrice: number;
  lastTradedPrice: number | null;
  lastTrade: Trade | null;
  topOfBook: {
    bestBid: OrderBookLevel | null;
    bestAsk: OrderBookLevel | null;
    spread: number | null;
  };
  depth: {
    bids: OrderBookLevel[];
    asks: OrderBookLevel[];
  };
  statisticsWindow: {
    fromTradeSequence: number | null;
    toTradeSequence: number | null;
  };
  statistics: TradeStatistics;
  generatedAt: string;
}

export interface MarketDataTradeEvent {
  eventId: string;
  eventType: 'TRADE';
  eventSequence: number;
  sessionId: string;
  occurredAt: string;
  trade: Trade;
}

export interface ReplayPoint {
  event: MarketDataTradeEvent;
  stateAfterEvent: {
    lastTradedPrice: number;
    statistics: TradeStatistics;
  };
}

export interface MarketDataReplay {
  seriesCode: string;
  compliancePeriod: number;
  vintageYear?: number;
  sessionId: string;
  points: ReplayPoint[];
  finalStatistics: TradeStatistics;
}
