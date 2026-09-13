import { LimitOrder } from './limit-order.types';
import { planMatches } from './matching-engine';

function order(overrides: Partial<LimitOrder>): LimitOrder {
  return {
    orderId: 'ORDER-1',
    participantId: 'IND-A',
    clientOrderId: 'CLIENT-1',
    seriesCode: 'PTBAE-IND',
    compliancePeriod: 2027,
    side: 'BUY',
    orderType: 'LIMIT',
    rulesetId: 'RULESET-1',
    correlationId: '00000000-0000-4000-8000-000000000001',
    quantity: 10,
    remainingQuantity: 10,
    limitPrice: 75_000,
    timeInForce: 'DAY',
    status: 'OPEN',
    reservationId: 'RESERVATION-1',
    prioritySequence: 10,
    createdAt: '2027-01-01T00:00:00.000Z',
    updatedAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('matching engine', () => {
  it('uses best price then FIFO and the resting order price', () => {
    const incoming = order({ orderId: 'BUY', participantId: 'IND-D', remainingQuantity: 12 });
    const later = order({
      orderId: 'ASK-LATER',
      participantId: 'IND-B',
      side: 'SELL',
      remainingQuantity: 5,
      limitPrice: 74_000,
      prioritySequence: 2,
    });
    const earlier = order({
      orderId: 'ASK-EARLIER',
      participantId: 'IND-C',
      side: 'SELL',
      remainingQuantity: 5,
      limitPrice: 74_000,
      prioritySequence: 1,
    });
    const best = order({
      orderId: 'ASK-BEST',
      participantId: 'IND-A',
      side: 'SELL',
      remainingQuantity: 5,
      limitPrice: 73_000,
      prioritySequence: 3,
    });

    expect(planMatches(incoming, [later, earlier, best])).toEqual([
      { restingOrder: best, quantity: 5, price: 73_000 },
      { restingOrder: earlier, quantity: 5, price: 74_000 },
      { restingOrder: later, quantity: 2, price: 74_000 },
    ]);
  });

  it('prevents self-match', () => {
    const incoming = order({ orderId: 'BUY', participantId: 'IND-A' });
    const ownAsk = order({ orderId: 'ASK', participantId: 'IND-A', side: 'SELL' });

    expect(planMatches(incoming, [ownAsk])).toEqual([]);
  });

  it('sweeps resting buyers from the highest bid when a sell order arrives', () => {
    const incoming = order({
      orderId: 'SELL',
      participantId: 'IND-A',
      side: 'SELL',
      remainingQuantity: 8,
      limitPrice: 74_000,
    });
    const lowerBid = order({
      orderId: 'LOWER-BID',
      participantId: 'IND-B',
      remainingQuantity: 5,
      limitPrice: 74_000,
      prioritySequence: 1,
    });
    const higherBid = order({
      orderId: 'HIGHER-BID',
      participantId: 'IND-D',
      remainingQuantity: 5,
      limitPrice: 75_000,
      prioritySequence: 2,
    });

    expect(planMatches(incoming, [lowerBid, higherBid])).toEqual([
      { restingOrder: higherBid, quantity: 5, price: 75_000 },
      { restingOrder: lowerBid, quantity: 3, price: 74_000 },
    ]);
  });
});
