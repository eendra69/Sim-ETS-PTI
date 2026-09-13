import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { HealthController } from './health.controller';
import { GovernanceModule } from './governance/governance.module';
import { LimitOrderModule } from './limit-order/limit-order.module';
import { MarketDataModule } from './market-data/market-data.module';
import { PositionBalanceModule } from './position-balance/position-balance.module';
import { SettlementModule } from './settlement/settlement.module';
import { ScenarioModule } from './scenario/scenario.module';
import { PlatformModule } from './platform/platform.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
    }),
    PlatformModule,
    PositionBalanceModule,
    GovernanceModule,
    LimitOrderModule,
    MarketDataModule,
    SettlementModule,
    ScenarioModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
