import { LimitOrder } from './limit-order.types';

export interface PlannedMatch {
  restingOrder: LimitOrder;
  quantity: number;
  price: number;
}

export function planMatches(incoming: LimitOrder, availableOrders: LimitOrder[]): PlannedMatch[] {
  const compatible = availableOrders
    .filter(
      (candidate) =>
        candidate.orderId !== incoming.orderId &&
        candidate.participantId !== incoming.participantId &&
        candidate.seriesCode === incoming.seriesCode &&
        candidate.compliancePeriod === incoming.compliancePeriod &&
        candidate.vintageYear === incoming.vintageYear &&
        candidate.side !== incoming.side &&
        candidate.orderType === 'LIMIT' &&
        isActive(candidate) &&
        isPriceCompatible(incoming, candidate),
    )
    .sort((left, right) => compareResting(incoming, left, right));

  let remaining = incoming.remainingQuantity;
  const matches: PlannedMatch[] = [];
  for (const restingOrder of compatible) {
    if (remaining === 0) break;
    const quantity = Math.min(remaining, restingOrder.remainingQuantity);
    if (quantity <= 0) continue;
    matches.push({ restingOrder, quantity, price: restingOrder.limitPrice! });
    remaining -= quantity;
  }
  return matches;
}

export function isActive(order: LimitOrder): boolean {
  return order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED';
}

function isPriceCompatible(incoming: LimitOrder, resting: LimitOrder): boolean {
  const boundary =
    incoming.orderType === 'MARKET' ? incoming.protectionPrice! : incoming.limitPrice!;
  return incoming.side === 'BUY'
    ? boundary >= resting.limitPrice!
    : boundary <= resting.limitPrice!;
}

function compareResting(incoming: LimitOrder, left: LimitOrder, right: LimitOrder): number {
  const pricePriority =
    incoming.side === 'BUY'
      ? left.limitPrice! - right.limitPrice!
      : right.limitPrice! - left.limitPrice!;
  return pricePriority || left.prioritySequence - right.prioritySequence;
}
