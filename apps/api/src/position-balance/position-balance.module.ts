import { Module } from '@nestjs/common';
import { PositionBalanceController } from './position-balance.controller';
import { PositionBalanceService } from './position-balance.service';

@Module({
  controllers: [PositionBalanceController],
  providers: [PositionBalanceService],
  exports: [PositionBalanceService],
})
export class PositionBalanceModule {}
