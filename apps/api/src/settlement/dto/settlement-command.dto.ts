import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class IdempotentCommandDto {
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;

  @IsOptional()
  @IsString()
  actorId?: string;

  @IsOptional()
  @IsString()
  permissionContext?: string;
}

export class FailSettlementDto extends IdempotentCommandDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class AcknowledgeRegistryDto extends IdempotentCommandDto {
  @IsString()
  @MinLength(3)
  registryReference!: string;

  @IsInt()
  @Min(1)
  acknowledgedQuantity!: number;
}

export class RejectRegistryDto extends IdempotentCommandDto {
  @IsString()
  @MinLength(3)
  reason!: string;
}

export class ResolveReconciliationDto extends AcknowledgeRegistryDto {}
