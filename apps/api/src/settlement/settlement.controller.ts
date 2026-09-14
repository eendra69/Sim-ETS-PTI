import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
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
import { Roles } from '../platform/auth.decorators';
import { AuthenticatedRequest, commandIdentity } from '../platform/auth.types';

@Controller()
export class SettlementController {
  constructor(private readonly settlementService: SettlementService) {}

  @Post('settlements/from-trade/:tradeId')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  createFromTrade(
    @Param('tradeId') tradeId: string,
    @Body() dto: IdempotentCommandDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<SettlementBundle> {
    return this.settlementService.createFromTrade(tradeId, commandIdentity(dto, request));
  }

  @Get('settlements')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  list(@Query() query: QuerySettlementDto): Promise<SettlementBundle[]> {
    return this.settlementService.list(query.seriesCode, query.compliancePeriod, query.vintageYear);
  }

  @Get('settlements/:settlementId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  get(@Param('settlementId') settlementId: string): Promise<SettlementBundle> {
    return this.settlementService.get(settlementId);
  }

  @Post('settlements/:settlementId/process')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  process(@Param('settlementId') settlementId: string, @Body() dto: IdempotentCommandDto, @Req() request: AuthenticatedRequest) {
    return this.settlementService.process(settlementId, commandIdentity(dto, request));
  }

  @Post('settlements/:settlementId/fail')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  fail(@Param('settlementId') settlementId: string, @Body() dto: FailSettlementDto, @Req() request: AuthenticatedRequest) {
    return this.settlementService.fail(settlementId, commandIdentity(dto, request));
  }

  @Post('settlements/:settlementId/retry')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  retrySettlement(@Param('settlementId') settlementId: string, @Body() dto: IdempotentCommandDto, @Req() request: AuthenticatedRequest) {
    return this.settlementService.retrySettlement(settlementId, commandIdentity(dto, request));
  }

  @Post('settlements/:settlementId/reverse')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  reverse(@Param('settlementId') settlementId: string, @Body() dto: IdempotentCommandDto, @Req() request: AuthenticatedRequest) {
    return this.settlementService.reverse(settlementId, commandIdentity(dto, request));
  }

  @Post('registry/messages/:registryMessageId/send')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  sendRegistry(@Param('registryMessageId') registryMessageId: string, @Body() dto: IdempotentCommandDto, @Req() request: AuthenticatedRequest) {
    return this.settlementService.sendRegistry(registryMessageId, commandIdentity(dto, request));
  }

  @Post('registry/messages/:registryMessageId/acknowledge')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  acknowledgeRegistry(
    @Param('registryMessageId') registryMessageId: string,
    @Body() dto: AcknowledgeRegistryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlementService.acknowledgeRegistry(registryMessageId, commandIdentity(dto, request));
  }

  @Post('registry/messages/:registryMessageId/reject')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  rejectRegistry(
    @Param('registryMessageId') registryMessageId: string,
    @Body() dto: RejectRegistryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlementService.rejectRegistry(registryMessageId, commandIdentity(dto, request));
  }

  @Post('registry/messages/:registryMessageId/retry')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  retryRegistry(
    @Param('registryMessageId') registryMessageId: string,
    @Body() dto: IdempotentCommandDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlementService.retryRegistry(registryMessageId, commandIdentity(dto, request));
  }

  @Post('reconciliations/:reconciliationId/resolve')
  @Roles('ADMIN', 'SETTLEMENT_OPERATOR', 'UAT_OPERATOR')
  resolveReconciliation(
    @Param('reconciliationId') reconciliationId: string,
    @Body() dto: ResolveReconciliationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.settlementService.resolveReconciliation(reconciliationId, commandIdentity(dto, request));
  }
}
