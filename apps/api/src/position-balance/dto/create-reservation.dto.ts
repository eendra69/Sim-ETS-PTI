import { Type } from 'class-transformer';
import { IsInt, IsPositive, IsString, Min } from 'class-validator';

export class CreateSellReservationDto {
  @IsString()
  participantId!: string;

  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;

  @Type(() => Number)
  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsString()
  orderReference!: string;
}

export class CreateBuyReservationDto extends CreateSellReservationDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  maximumNotional!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  feeBuffer!: number;
}
