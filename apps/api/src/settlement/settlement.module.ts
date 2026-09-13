import { Module } from '@nestjs/common';
import { LimitOrderModule } from '../limit-order/limit-order.module';
import { PositionBalanceModule } from '../position-balance/position-balance.module';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

@Module({
  imports: [LimitOrderModule, PositionBalanceModule],
  controllers: [SettlementController],
  providers: [SettlementService],
  exports: [SettlementService],
})
export class SettlementModule {}
