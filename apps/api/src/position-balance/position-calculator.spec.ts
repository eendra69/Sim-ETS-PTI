import { demoBalances, demoPositions } from './demo-fixtures';
import { calculatePosition } from './position-calculator';

describe('calculatePosition', () => {
  it.each([
    ['IND-A', 30_000, 'SURPLUS', 30_000, 0],
    ['IND-B', 50_000, 'SURPLUS', 50_000, 0],
    ['IND-C', 40_000, 'SURPLUS', 40_000, 0],
    ['IND-D', -60_000, 'DEFICIT', 0, 60_000],
  ] as const)(
    'calculates the documented fixture for %s',
    (participantId, netPosition, status, maxSell, buyNeed) => {
      const position = demoPositions.find((item) => item.participantId === participantId)!;
      const balance = demoBalances.find((item) => item.participantId === participantId)!;
      const result = calculatePosition(position, balance);

      expect(result.netPosition).toBe(netPosition);
      expect(result.positionStatus).toBe(status);
      expect(result.maxSellQuantity).toBe(maxSell);
      expect(result.buyNeedRemaining).toBe(buyNeed);
    },
  );

  it('uses the lower of physical availability and verified surplus', () => {
    const result = calculatePosition(demoPositions[0]!, {
      ...demoBalances[0]!,
      eligibleHolding: 20_000,
    });

    expect(result.maxSellQuantity).toBe(20_000);
  });
});
