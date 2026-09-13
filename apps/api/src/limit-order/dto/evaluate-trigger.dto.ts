import { IsUUID } from 'class-validator';

export class EvaluateTriggerDto {
  @IsUUID()
  sourceTradeId!: string;
}
