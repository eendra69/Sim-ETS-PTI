import { Module } from '@nestjs/common';
import { PositionBalanceModule } from '../position-balance/position-balance.module';
import { LimitOrderController } from './limit-order.controller';
import { LimitOrderService } from './limit-order.service';

@Module({
  imports: [PositionBalanceModule],
  controllers: [LimitOrderController],
  providers: [LimitOrderService],
  exports: [LimitOrderService],
})
export class LimitOrderModule {}
