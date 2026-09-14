import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class VintageQueryDto {
  @IsOptional()
  @IsString()
  seriesCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  targetCompliancePeriod?: number;
}

export class AdmissionQueryDto {
  @IsOptional()
  @IsString()
  seriesCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  vintageYear?: number;
}

export class InstallationQueryDto {
  @IsOptional()
  @IsString()
  participantId?: string;
}

export class TraderScopeQueryDto {
  @IsOptional()
  @IsString()
  traderAccountId?: string;

  @IsOptional()
  @IsString()
  participantId?: string;
}

export class HoldingQueryDto {
  @IsOptional()
  @IsString()
  participantId?: string;

  @IsOptional()
  @IsString()
  installationId?: string;

  @IsOptional()
  @IsString()
  seriesCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  vintageYear?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  targetCompliancePeriod?: number;
}

export class EligibilityQueryDto {
  @IsString()
  seriesCode!: string;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  vintageYear!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  targetCompliancePeriod!: number;
}

