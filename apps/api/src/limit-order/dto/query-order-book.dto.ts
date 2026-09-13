import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class QueryOrderBookDto {
  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;
}
