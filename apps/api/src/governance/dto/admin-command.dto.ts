import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class AdminCommandDto {
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsString()
  @MinLength(2)
  actorId!: string;

  @IsString()
  @MinLength(2)
  permissionContext!: string;

  @IsOptional()
  @IsString()
  causationId?: string;
}

export class CreateRulesetDto extends AdminCommandDto {
  @IsString()
  rulesetId!: string;

  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  referencePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  minimumPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tickSize!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  lotSize!: number;

  @IsString()
  marketSessionId!: string;

  @IsOptional()
  @IsISO8601()
  effectiveFrom?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  sellCapPercentage?: number;

  @IsOptional()
  @IsIn(['DVP_SETTLED', 'SRUK_ACK_RECONCILED'])
  settlementFinality?: 'DVP_SETTLED' | 'SRUK_ACK_RECONCILED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  surveillancePriceDeviationBps?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  surveillanceVolumeThreshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  repeatedCancelThreshold?: number;
}

export class UpdateRulesetDto extends AdminCommandDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  referencePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  minimumPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  maximumPrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  tickSize!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  lotSize!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  sellCapPercentage!: number;

  @IsIn(['DVP_SETTLED', 'SRUK_ACK_RECONCILED'])
  settlementFinality!: 'DVP_SETTLED' | 'SRUK_ACK_RECONCILED';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  surveillancePriceDeviationBps!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  surveillanceVolumeThreshold!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  repeatedCancelThreshold!: number;
}

export class QueryGovernanceDto {
  @IsOptional()
  @IsString()
  seriesCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  compliancePeriod?: number;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
