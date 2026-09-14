import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class QueryOrderBookDto {
  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  vintageYear?: number;
}
