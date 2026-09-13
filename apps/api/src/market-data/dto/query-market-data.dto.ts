import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { QueryOrderBookDto } from '../../limit-order/dto/query-order-book.dto';

export class QueryMarketDataDto extends QueryOrderBookDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fromTradeSequence?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  toTradeSequence?: number;
}

export class QueryMarketDataEventsDto extends QueryOrderBookDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterTradeSequence: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  limit: number = 100;
}
