import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PositionBalanceModule } from './position-balance/position-balance.module';

@Module({
  imports: [PositionBalanceModule],
  controllers: [HealthController],
})
export class AppModule {}
