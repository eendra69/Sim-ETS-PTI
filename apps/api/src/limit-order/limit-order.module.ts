import { Module } from '@nestjs/common';
import { PositionBalanceModule } from '../position-balance/position-balance.module';
import { GovernanceModule } from '../governance/governance.module';
import { LimitOrderController } from './limit-order.controller';
import { LimitOrderService } from './limit-order.service';

@Module({
  imports: [PositionBalanceModule, GovernanceModule],
  controllers: [LimitOrderController],
  providers: [LimitOrderService],
  exports: [LimitOrderService],
})
export class LimitOrderModule {}
