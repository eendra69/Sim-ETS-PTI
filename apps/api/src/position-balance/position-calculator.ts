import { AnnualPositionInput, BalanceAccount, PositionSnapshot } from './position.types';

const numericFields: Array<keyof AnnualPositionInput> = [
  'allocatedQuota',
  'verifiedEmission',
  'acknowledgedPurchases',
  'acknowledgedSales',
  'eligibleBankedUnits',
  'eligibleOffsetApplied',
];

export function assertPositionInput(input: AnnualPositionInput): void {
  for (const field of numericFields) {
    const value = input[field];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
}

export function calculatePosition(
  input: AnnualPositionInput,
  balance: BalanceAccount,
): PositionSnapshot {
  assertPositionInput(input);

  const grossPosition = input.allocatedQuota - input.verifiedEmission;
  const netPosition =
    input.allocatedQuota +
    input.acknowledgedPurchases -
    input.acknowledgedSales +
    input.eligibleBankedUnits +
    input.eligibleOffsetApplied -
    input.verifiedEmission;

  const verifiedSurplusRemaining = Math.max(0, netPosition);
  const buyNeedRemaining = Math.max(0, -netPosition);
  const physicalTradableAvailable = Math.max(
    0,
    balance.eligibleHolding - balance.lockedUnits - balance.surrenderedUnits,
  );
  const maxSellQuantity = Math.min(physicalTradableAvailable, verifiedSurplusRemaining);
  const committedSell = balance.reservedSell + balance.executedSellPending;
  const committedBuy = balance.reservedBuyQuantity + balance.executedBuyPending;

  return {
    ...input,
    grossPosition,
    netPosition,
    positionStatus: netPosition > 0 ? 'SURPLUS' : netPosition < 0 ? 'DEFICIT' : 'BALANCED',
    verifiedSurplusRemaining,
    buyNeedRemaining,
    physicalTradableAvailable,
    maxSellQuantity,
    availableToSell: Math.max(0, maxSellQuantity - committedSell),
    reservedSell: balance.reservedSell,
    executedSellPending: balance.executedSellPending,
    buyingCapacity: balance.buyingCapacity,
    reservedBuyFunds: balance.reservedBuyFunds,
    availableBuyingCapacity: Math.max(
      0,
      balance.buyingCapacity - balance.reservedBuyFunds - balance.executedBuyPendingFunds,
    ),
    reservedBuyQuantity: balance.reservedBuyQuantity,
    executedBuyPending: balance.executedBuyPending,
    executedBuyPendingFunds: balance.executedBuyPendingFunds,
    availableBuyNeed: Math.max(0, buyNeedRemaining - committedBuy),
    unit: 'tCO2e',
  };
}
