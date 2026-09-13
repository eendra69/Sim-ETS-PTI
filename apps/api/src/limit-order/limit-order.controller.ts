import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderBookDto } from './dto/query-order-book.dto';
import { LimitOrderService } from './limit-order.service';
import { LimitOrder, MarketRuleset, OrderBookSnapshot, Trade } from './limit-order.types';

@Controller()
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Get('market-rulesets/current')
  getRuleset(): MarketRuleset {
    return this.limitOrderService.getRuleset();
  }

  @Post('orders')
  submit(@Body() dto: CreateOrderDto): Promise<LimitOrder> {
    return this.limitOrderService.submit(dto);
  }

  @Get('orders')
  listOrders(@Query() query: QueryOrderBookDto): Promise<LimitOrder[]> {
    return this.limitOrderService.listOrders(query.seriesCode, query.compliancePeriod);
  }

  @Get('orders/:orderId')
  getOrder(@Param('orderId') orderId: string): Promise<LimitOrder> {
    return this.limitOrderService.getOrder(orderId);
  }

  @Delete('orders/:orderId')
  cancel(@Param('orderId') orderId: string): Promise<LimitOrder> {
    return this.limitOrderService.cancel(orderId);
  }

  @Post('orders/expire-day')
  expireDayOrders(@Query() query: QueryOrderBookDto): Promise<LimitOrder[]> {
    return this.limitOrderService.expireDayOrders(query.seriesCode, query.compliancePeriod);
  }

  @Get('order-book')
  getOrderBook(@Query() query: QueryOrderBookDto): Promise<OrderBookSnapshot> {
    return this.limitOrderService.getOrderBook(query.seriesCode, query.compliancePeriod);
  }

  @Get('trades')
  listTrades(@Query() query: QueryOrderBookDto): Promise<Trade[]> {
    return this.limitOrderService.listTrades(query.seriesCode, query.compliancePeriod);
  }

  @Get('trades/:tradeId')
  getTrade(@Param('tradeId') tradeId: string): Promise<Trade> {
    return this.limitOrderService.getTrade(tradeId);
  }
}
