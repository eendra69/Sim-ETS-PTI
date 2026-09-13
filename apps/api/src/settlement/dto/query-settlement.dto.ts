import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class QuerySettlementDto {
  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;
}
