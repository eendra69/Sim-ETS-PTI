import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AdminCommandDto, CreateRulesetDto, QueryGovernanceDto, UpdateRulesetDto } from './dto/admin-command.dto';
import { GovernanceService } from './governance.service';

@Controller()
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('rulesets')
  listRulesets(@Query() query: QueryGovernanceDto) {
    return this.governance.listRulesets(query.seriesCode, query.compliancePeriod);
  }

  @Get('rulesets/:rulesetId')
  getRuleset(@Param('rulesetId') rulesetId: string) {
    return this.governance.getRuleset(rulesetId);
  }

  @Post('rulesets')
  createRuleset(@Body() dto: CreateRulesetDto) {
    return this.governance.createDraft(dto);
  }

  @Put('rulesets/:rulesetId')
  updateRuleset(@Param('rulesetId') rulesetId: string, @Body() dto: UpdateRulesetDto) {
    return this.governance.updateDraft(rulesetId, dto);
  }

  @Post('rulesets/:rulesetId/approve')
  approveRuleset(@Param('rulesetId') rulesetId: string, @Body() dto: AdminCommandDto) {
    return this.governance.approve(rulesetId, dto);
  }

  @Post('rulesets/:rulesetId/activate')
  activateRuleset(@Param('rulesetId') rulesetId: string, @Body() dto: AdminCommandDto) {
    return this.governance.activate(rulesetId, dto);
  }

  @Get('market-sessions/:sessionId')
  getSession(@Param('sessionId') sessionId: string) {
    return this.governance.getSession(sessionId);
  }

  @Post('market-sessions/:sessionId/open')
  open(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto) {
    return this.governance.transitionSession(sessionId, 'OPEN', dto);
  }

  @Post('market-sessions/:sessionId/halt')
  halt(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto) {
    return this.governance.transitionSession(sessionId, 'HALT', dto);
  }

  @Post('market-sessions/:sessionId/resume')
  resume(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto) {
    return this.governance.transitionSession(sessionId, 'RESUME', dto);
  }

  @Post('market-sessions/:sessionId/close')
  close(@Param('sessionId') sessionId: string, @Body() dto: AdminCommandDto) {
    return this.governance.transitionSession(sessionId, 'CLOSE', dto);
  }

  @Get('audit-events')
  listAuditEvents(@Query() query: QueryGovernanceDto) {
    return this.governance.listAuditEvents(query.correlationId, query.entityType, query.limit);
  }

  @Get('surveillance-alerts')
  listAlerts(@Query() query: QueryGovernanceDto) {
    return this.governance.listAlerts(query.limit);
  }
}
