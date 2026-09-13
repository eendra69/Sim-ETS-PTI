import { Module } from '@nestjs/common';
import { LimitOrderModule } from '../limit-order/limit-order.module';
import { MarketDataController } from './market-data.controller';
import { MarketDataService } from './market-data.service';

@Module({
  imports: [LimitOrderModule],
  controllers: [MarketDataController],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
