import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { EvaluateTriggerDto } from './dto/evaluate-trigger.dto';
import { QueryOrderBookDto } from './dto/query-order-book.dto';
import { LimitOrderService } from './limit-order.service';
import {
  MarketRuleset,
  Order,
  OrderBookSnapshot,
  Trade,
  TriggerBookSnapshot,
  TriggerEvent,
} from './limit-order.types';
import { Roles } from '../platform/auth.decorators';
import { AuthenticatedRequest } from '../platform/auth.types';

@Controller()
export class LimitOrderController {
  constructor(private readonly limitOrderService: LimitOrderService) {}

  @Get('market-rulesets/current')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getRuleset(): MarketRuleset {
    return this.limitOrderService.getRuleset();
  }

  @Post('orders')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  submit(@Body() dto: CreateOrderDto, @Req() request: AuthenticatedRequest): Promise<Order> {
    this.assertParticipantAccess(request, dto.participantId);
    return this.limitOrderService.submit(dto);
  }

  @Get('orders')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  listOrders(@Query() query: QueryOrderBookDto): Promise<Order[]> {
    return this.limitOrderService.listOrders(query.seriesCode, query.compliancePeriod);
  }

  @Get('orders/:orderId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getOrder(@Param('orderId') orderId: string): Promise<Order> {
    return this.limitOrderService.getOrder(orderId);
  }

  @Delete('orders/:orderId')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  async cancel(@Param('orderId') orderId: string, @Req() request: AuthenticatedRequest): Promise<Order> {
    const order = await this.limitOrderService.getOrder(orderId);
    this.assertParticipantAccess(request, order.participantId);
    return this.limitOrderService.cancel(orderId);
  }

  @Post('orders/expire-day')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  expireDayOrders(@Query() query: QueryOrderBookDto): Promise<Order[]> {
    return this.limitOrderService.expireDayOrders(query.seriesCode, query.compliancePeriod);
  }

  @Get('order-book')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getOrderBook(@Query() query: QueryOrderBookDto): Promise<OrderBookSnapshot> {
    return this.limitOrderService.getOrderBook(query.seriesCode, query.compliancePeriod);
  }

  @Get('trigger-book')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getTriggerBook(@Query() query: QueryOrderBookDto): Promise<TriggerBookSnapshot> {
    return this.limitOrderService.getTriggerBook(query.seriesCode, query.compliancePeriod);
  }

  @Post('trigger-book/evaluate')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  evaluateTriggers(@Body() dto: EvaluateTriggerDto): Promise<TriggerEvent[]> {
    return this.limitOrderService.evaluateTriggersForTrade(dto.sourceTradeId);
  }

  @Get('trigger-events')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  listTriggerEvents(@Query() query: QueryOrderBookDto): Promise<TriggerEvent[]> {
    return this.limitOrderService.listTriggerEvents(query.seriesCode, query.compliancePeriod);
  }

  @Get('trigger-events/:triggerEventId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getTriggerEvent(@Param('triggerEventId') triggerEventId: string): Promise<TriggerEvent> {
    return this.limitOrderService.getTriggerEvent(triggerEventId);
  }

  @Get('trades')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  listTrades(@Query() query: QueryOrderBookDto): Promise<Trade[]> {
    return this.limitOrderService.listTrades(query.seriesCode, query.compliancePeriod);
  }

  @Get('trades/:tradeId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getTrade(@Param('tradeId') tradeId: string): Promise<Trade> {
    return this.limitOrderService.getTrade(tradeId);
  }

  private assertParticipantAccess(request: AuthenticatedRequest, participantId: string): void {
    const identity = request.identity;
    if (!identity || !identity.roles.includes('TRADER')) return;
    if (identity.roles.some((role) => ['ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR'].includes(role))) return;
    if (!identity.participantId || identity.participantId !== participantId) {
      throw new ForbiddenException('Trader identity cannot act for another participant');
    }
  }
}
