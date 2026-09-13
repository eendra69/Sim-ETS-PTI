import { Type } from 'class-transformer';
import { IsIn, IsInt, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { OrderSide, OrderType, TimeInForce } from '../limit-order.types';

export class CreateLimitOrderDto {
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

  @IsIn(['LIMIT'])
  orderType!: OrderType;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  limitPrice!: number;

  @IsIn(['DAY', 'GTC'])
  timeInForce!: TimeInForce;
}
