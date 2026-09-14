import { Controller, Get, Query } from '@nestjs/common';
import { QueryMarketDataDto, QueryMarketDataEventsDto } from './dto/query-market-data.dto';
import { MarketDataService } from './market-data.service';
import {
  MarketDataReplay,
  MarketDataSnapshot,
  MarketDataTradeEvent,
} from './market-data.types';
import { Roles } from '../platform/auth.decorators';

@Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
@Controller('market-data')
export class MarketDataController {
  constructor(private readonly marketDataService: MarketDataService) {}

  @Get('snapshot')
  getSnapshot(@Query() query: QueryMarketDataDto): Promise<MarketDataSnapshot> {
    return this.marketDataService.getSnapshot(
      query.seriesCode,
      query.compliancePeriod,
      query.fromTradeSequence,
      query.toTradeSequence,
      query.vintageYear,
    );
  }

  @Get('events')
  listEvents(@Query() query: QueryMarketDataEventsDto): Promise<MarketDataTradeEvent[]> {
    return this.marketDataService.listEvents(
      query.seriesCode,
      query.compliancePeriod,
      query.afterTradeSequence,
      query.limit,
      query.vintageYear,
    );
  }

  @Get('replay')
  replay(@Query() query: QueryMarketDataDto): Promise<MarketDataReplay> {
    return this.marketDataService.replay(
      query.seriesCode,
      query.compliancePeriod,
      query.fromTradeSequence,
      query.toTradeSequence,
      query.vintageYear,
    );
  }
}
