import { BadRequestException } from '@nestjs/common';
import { MarketRuleset } from './limit-order.types';

export const BASELINE_MARKET_RULESET: MarketRuleset = {
  rulesetId: 'PTBAE-IND-2027-PROTOTYPE-V1',
  seriesCode: 'PTBAE-IND',
  compliancePeriod: 2027,
  referencePrice: 75_000,
  minimumPrice: 60_000,
  maximumPrice: 90_000,
  tickSize: 200,
  lotSize: 1,
  currency: 'IDR',
  marketTimeInForce: 'IOC',
  marketProtectionRequired: true,
  stopTriggerBasis: 'LTP',
  stopBuyDirection: 'GREATER_THAN_OR_EQUAL',
  stopSellDirection: 'LESS_THAN_OR_EQUAL',
  stopActivationType: 'MARKET',
  stopReservationTiming: 'SUBMISSION',
  marketSessionId: 'PTBAE-IND-2027-REGULAR',
};

export function validateAgainstRuleset(
  seriesCode: string,
  compliancePeriod: number,
  quantity: number,
  price: number,
): void {
  const rules = BASELINE_MARKET_RULESET;
  if (seriesCode !== rules.seriesCode || compliancePeriod !== rules.compliancePeriod) {
    throw new BadRequestException({
      code: 'ORD-UNSUPPORTED-MARKET',
      message: 'No active prototype ruleset exists for the requested series and period',
    });
  }
  if (quantity % rules.lotSize !== 0) {
    throw new BadRequestException({
      code: 'ORD-INVALID-LOT',
      message: `Quantity must be a multiple of ${rules.lotSize}`,
    });
  }
  if (price < rules.minimumPrice || price > rules.maximumPrice) {
    throw new BadRequestException({
      code: 'ORD-PRICE-OUTSIDE-BAND',
      message: `Order price must be between ${rules.minimumPrice} and ${rules.maximumPrice}`,
    });
  }
  if (price % rules.tickSize !== 0) {
    throw new BadRequestException({
      code: 'ORD-INVALID-TICK',
      message: `Order price must be a multiple of ${rules.tickSize}`,
    });
  }
}
