import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { AdminCommandDto, CreateRulesetDto, QueryGovernanceDto, UpdateRulesetDto } from './dto/admin-command.dto';
import { GovernanceService } from './governance.service';
import { Roles } from '../platform/auth.decorators';
import { AuthenticatedRequest, commandIdentity } from '../platform/auth.types';

@Controller()
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('rulesets')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  listRulesets(@Query() query: QueryGovernanceDto) {
    return this.governance.listRulesets(query.seriesCode, query.compliancePeriod);
  }

  @Get('rulesets/:rulesetId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getRuleset(@Param('rulesetId') rulesetId: string) {
    return this.governance.getRuleset(rulesetId);
  }

  @Post('rulesets')
  @Roles('ADMIN', 'UAT_OPERATOR')
  createRuleset(@Body() dto: CreateRulesetDto, @Req() request: AuthenticatedRequest) {
    return this.governance.createDraft(commandIdentity(dto, request));
  }

  @Put('rulesets/:rulesetId')
  @Roles('ADMIN', 'UAT_OPERATOR')
  updateRuleset(@Param('rulesetId') rulesetId: string, @Body() dto: UpdateRulesetDto, @Req() request: AuthenticatedRequest) {
    return this.governance.updateDraft(rulesetId, commandIdentity(dto, request));
  }

  @Post('rulesets/:rulesetId/approve')
  @Roles('ADMIN', 'UAT_OPERATOR')
  approveRuleset(@Param('rulesetId') rulesetId: string, @Body() dto: AdminCommandDto, @Req() request: AuthenticatedRequest) {
    return this.governance.approve(rulesetId, commandIdentity(dto, request));
  }

  @Post('rulesets/:rulesetId/activate')
  @Roles('ADMIN', 'UAT_OPERATOR')
  activateRuleset(@Param('rulesetId') rulesetId: string, @Body() dto: AdminCommandDto, @Req() request: AuthenticatedRequest) {
    return this.governance.activate(rulesetId, commandIdentity(dto, request));
  }

  @Get('market-sessions/:sessionId')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'SETTLEMENT_OPERATOR', 'TRADER', 'UAT_OPERATOR')
  getSession(@Param('sessionId') sessionId: string) {
    return this.governance.getSession(sessionId);
  }

  @Post('market-sessions/:sessionId/open')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  open(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto, @Req() request: AuthenticatedRequest) {
    return this.governance.transitionSession(sessionId, 'OPEN', commandIdentity(dto, request));
  }

  @Post('market-sessions/:sessionId/halt')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  halt(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto, @Req() request: AuthenticatedRequest) {
    return this.governance.transitionSession(sessionId, 'HALT', commandIdentity(dto, request));
  }

  @Post('market-sessions/:sessionId/resume')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  resume(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto, @Req() request: AuthenticatedRequest) {
    return this.governance.transitionSession(sessionId, 'RESUME', commandIdentity(dto, request));
  }

  @Post('market-sessions/:sessionId/close')
  @Roles('ADMIN', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  close(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto, @Req() request: AuthenticatedRequest) {
    return this.governance.transitionSession(sessionId, 'CLOSE', commandIdentity(dto, request));
  }

  @Get('audit-events')
  @Roles('ADMIN', 'AUDITOR', 'UAT_OPERATOR')
  listAuditEvents(@Query() query: QueryGovernanceDto) {
    return this.governance.listAuditEvents(query.correlationId, query.entityType, query.limit);
  }

  @Get('surveillance-alerts')
  @Roles('ADMIN', 'AUDITOR', 'MARKET_OPERATOR', 'UAT_OPERATOR')
  listAlerts(@Query() query: QueryGovernanceDto) {
    return this.governance.listAlerts(query.limit);
  }
}
