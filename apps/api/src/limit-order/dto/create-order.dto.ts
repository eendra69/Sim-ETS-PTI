import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { OrderSide, OrderType, TimeInForce } from '../limit-order.types';

export class CreateOrderDto {
  @IsString()
  @MaxLength(80)
  participantId!: string;

  @IsString()
  @MaxLength(100)
  clientOrderId!: string;

  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;

  @IsIn(['BUY', 'SELL'])
  side!: OrderSide;

  @IsIn(['LIMIT', 'MARKET', 'STOP'])
  orderType!: OrderType;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  limitPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  protectionPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  stopPrice?: number;

  @IsOptional()
  @IsIn(['LTP'])
  triggerBasis?: 'LTP';

  @IsOptional()
  @IsIn(['MARKET'])
  activationType?: 'MARKET';

  @IsIn(['DAY', 'GTC', 'IOC'])
  timeInForce!: TimeInForce;
}
