export type OrderSide = 'BUY' | 'SELL';
export type ExecutableOrderType = 'LIMIT' | 'MARKET';
export type OrderType = ExecutableOrderType | 'STOP';
export type TimeInForce = 'DAY' | 'GTC' | 'IOC';
export type LimitOrderStatus =
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'CANCELLED_REMAINDER';

export interface LimitOrder {
  orderId: string;
  participantId: string;
  clientOrderId: string;
  seriesCode: string;
  compliancePeriod: number;
  side: OrderSide;
  orderType: ExecutableOrderType;
  rulesetId: string;
  correlationId: string;
  causationId?: string;
  quantity: number;
  remainingQuantity: number;
  limitPrice?: number;
  protectionPrice?: number;
  timeInForce: TimeInForce;
  status: LimitOrderStatus;
  reservationId: string;
  parentStopOrderId?: string;
  prioritySequence: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export type StopOrderStatus =
  | 'TRIGGER_PENDING'
  | 'ACTIVATED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'ACTIVATION_FAILED';

export interface StopOrder {
  orderId: string;
  participantId: string;
  clientOrderId: string;
  seriesCode: string;
  compliancePeriod: number;
  side: OrderSide;
  orderType: 'STOP';
  rulesetId: string;
  correlationId: string;
  causationId?: string;
  quantity: number;
  remainingQuantity: number;
  stopPrice: number;
  protectionPrice: number;
  triggerBasis: 'LTP';
  activationType: 'MARKET';
  timeInForce: Extract<TimeInForce, 'DAY' | 'GTC'>;
  status: StopOrderStatus;
  reservationId: string;
  prioritySequence: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  triggeredAt?: string;
  activatedOrderId?: string;
}

export type Order = LimitOrder | StopOrder;

export interface TriggerEvent {
  triggerEventId: string;
  stopOrderId: string;
  sourceTradeId: string;
  observedLtp: number;
  triggerBasis: 'LTP';
  activatedOrderId: string;
  activatedTradeIds: string[];
  correlationId: string;
  triggeredAt: string;
}

export interface TriggerBookSnapshot {
  seriesCode: string;
  compliancePeriod: number;
  entries: StopOrder[];
  generatedAt: string;
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
  marketTimeInForce: 'IOC';
  marketProtectionRequired: true;
  stopTriggerBasis: 'LTP';
  stopBuyDirection: 'GREATER_THAN_OR_EQUAL';
  stopSellDirection: 'LESS_THAN_OR_EQUAL';
  stopActivationType: 'MARKET';
  stopReservationTiming: 'SUBMISSION';
  marketSessionId: string;
  version: number;
  status: 'DRAFT' | 'APPROVED' | 'ACTIVE' | 'RETIRED';
  effectiveFrom?: string;
  effectiveTo?: string;
  allowedLimitTimeInForce: Array<'DAY' | 'GTC'>;
  sellCapPercentage: number;
  settlementFinality: 'DVP_SETTLED' | 'SRUK_ACK_RECONCILED';
  surveillancePriceDeviationBps: number;
  surveillanceVolumeThreshold: number;
  repeatedCancelThreshold: number;
}

export interface TradeLeg {
  tradeLegId: string;
  tradeId: string;
  participantId: string;
  orderId: string;
  side: OrderSide;
  quantity: number;
  notional: number;
  unitDelta: number;
  cashDelta: number;
  status: 'EXECUTED';
  createdAt: string;
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
  correlationId: string;
  causationId?: string;
  status: 'EXECUTED';
  tradeSequence: number;
  executedAt: string;
  legs: TradeLeg[];
}
