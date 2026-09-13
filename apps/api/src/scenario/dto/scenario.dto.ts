import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class ScenarioCommandDto {
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsString()
  actorId!: string;
}

export class CreateScenarioDto extends ScenarioCommandDto {
  @IsString()
  name!: string;

  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  compliancePeriod!: number;

  @IsString()
  rulesetId!: string;

  @IsObject()
  seed!: {
    initialPositions: Record<string, number>;
    orders: Array<{ participantId: string; side: 'BUY' | 'SELL'; quantity: number; price: number }>;
    autoSettle: boolean;
  };
}

export class CompareScenarioDto {
  @IsString()
  leftRunId!: string;

  @IsString()
  rightRunId!: string;
}
