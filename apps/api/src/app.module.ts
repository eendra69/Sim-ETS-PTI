import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { HealthController } from './health.controller';
import { LimitOrderModule } from './limit-order/limit-order.module';
import { PositionBalanceModule } from './position-balance/position-balance.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
    }),
    PositionBalanceModule,
    LimitOrderModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
