import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { BASELINE_PERIOD, BASELINE_SERIES } from '../position.types';

export class QueryPositionDto {
  @IsOptional()
  @IsString()
  seriesCode: string = BASELINE_SERIES;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(2000)
  compliancePeriod: number = BASELINE_PERIOD;
}
