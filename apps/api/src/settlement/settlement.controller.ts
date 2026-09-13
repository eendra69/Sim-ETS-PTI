import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { QuerySettlementDto } from './dto/query-settlement.dto';
import {
  AcknowledgeRegistryDto,
  FailSettlementDto,
  IdempotentCommandDto,
  RejectRegistryDto,
  ResolveReconciliationDto,
} from './dto/settlement-command.dto';
import { SettlementService } from './settlement.service';
import { SettlementBundle } from './settlement.types';

@Controller()
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('settlements/from-trade/:tradeId')
  createFromTrade(
    @Param('tradeId') tradeId: string,
    @Body() dto: IdempotentCommandDto,
  ): Promise<SettlementBundle> {
    return this.settlementService.createFromTrade(tradeId, dto);
  }

  @Get('settlements')
  list(@Query() query: QuerySettlementDto): Promise<SettlementBundle[]> {
    return this.settlementService.list(query.seriesCode, query.compliancePeriod);
  }

  @Get('settlements/:settlementId')
  get(@Param('settlementId') settlementId: string): Promise<SettlementBundle> {
    return this.settlementService.get(settlementId);
  }

  @Post('settlements/:settlementId/process')
  process(@Param('settlementId') settlementId: string, @Body() dto: IdempotentCommandDto) {
    return this.settlementService.process(settlementId, dto);
  }

  @Post('settlements/:settlementId/fail')
  fail(@Param('settlementId') settlementId: string, @Body() dto: FailSettlementDto) {
    return this.settlementService.fail(settlementId, dto);
  }

  @Post('settlements/:settlementId/retry')
  retrySettlement(@Param('settlementId') settlementId: string, @Body() dto: IdempotentCommandDto) {
    return this.settlementService.retrySettlement(settlementId, dto);
  }

  @Post('settlements/:settlementId/reverse')
  reverse(@Param('settlementId') settlementId: string, @Body() dto: IdempotentCommandDto) {
    return this.settlementService.reverse(settlementId, dto);
  }

  @Post('registry/messages/:registryMessageId/send')
  sendRegistry(@Param('registryMessageId') registryMessageId: string, @Body() dto: IdempotentCommandDto) {
    return this.settlementService.sendRegistry(registryMessageId, dto);
  }

  @Post('registry/messages/:registryMessageId/acknowledge')
  acknowledgeRegistry(
    @Param('registryMessageId') registryMessageId: string,
    @Body() dto: AcknowledgeRegistryDto,
  ) {
    return this.settlementService.acknowledgeRegistry(registryMessageId, dto);
  }

  @Post('registry/messages/:registryMessageId/reject')
  rejectRegistry(
    @Param('registryMessageId') registryMessageId: string,
    @Body() dto: RejectRegistryDto,
  ) {
    return this.settlementService.rejectRegistry(registryMessageId, dto);
  }

  @Post('registry/messages/:registryMessageId/retry')
  retryRegistry(
    @Param('registryMessageId') registryMessageId: string,
    @Body() dto: IdempotentCommandDto,
  ) {
    return this.settlementService.retryRegistry(registryMessageId, dto);
  }

  @Post('reconciliations/:reconciliationId/resolve')
  resolveReconciliation(
    @Param('reconciliationId') reconciliationId: string,
    @Body() dto: ResolveReconciliationDto,
  ) {
    return this.settlementService.resolveReconciliation(reconciliationId, dto);
  }
}
