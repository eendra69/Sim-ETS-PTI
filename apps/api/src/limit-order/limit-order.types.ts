export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT';
export type TimeInForce = 'DAY' | 'GTC';
export type LimitOrderStatus =
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface LimitOrder {
  orderId: string;
  participantId: string;
  clientOrderId: string;
  seriesCode: string;
  compliancePeriod: number;
  side: OrderSide;
  orderType: OrderType;
  rulesetId: string;
  quantity: number;
  remainingQuantity: number;
  limitPrice: number;
  timeInForce: TimeInForce;
  status: LimitOrderStatus;
  reservationId: string;
  prioritySequence: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface OrderBookSnapshot {
  seriesCode: string;
  compliancePeriod: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  orders: {
    bids: LimitOrder[];
    asks: LimitOrder[];
  };
  generatedAt: string;
}

export interface MarketRuleset {
  rulesetId: string;
  seriesCode: string;
  compliancePeriod: number;
  referencePrice: number;
  minimumPrice: number;
  maximumPrice: number;
  tickSize: number;
  lotSize: number;
  currency: 'IDR';
}

export interface Trade {
  tradeId: string;
  matchEventId: string;
  buyerOrderId: string;
  sellerOrderId: string;
  buyerParticipantId: string;
  sellerParticipantId: string;
  seriesCode: string;
  compliancePeriod: number;
  quantity: number;
  price: number;
  notional: number;
  rulesetId: string;
  status: 'EXECUTED';
  tradeSequence: number;
  executedAt: string;
}
