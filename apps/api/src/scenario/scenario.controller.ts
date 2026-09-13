import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { CompareScenarioDto, CreateScenarioDto, ScenarioCommandDto } from './dto/scenario.dto';
import { ScenarioService } from './scenario.service';
import { Roles } from '../platform/auth.decorators';
import { AuthenticatedRequest, commandIdentity } from '../platform/auth.types';

@Roles('ADMIN', 'AUDITOR', 'UAT_OPERATOR')
@Controller('scenarios')
export class ScenarioController {
  constructor(private readonly scenarios:ScenarioService){}
  @Post() create(@Body() dto:CreateScenarioDto,@Req() request:AuthenticatedRequest){return this.scenarios.create(commandIdentity(dto,request));}
  @Get() list(){return this.scenarios.list();}
  @Get(':scenarioId') get(@Param('scenarioId') id:string){return this.scenarios.get(id);}
  @Post(':scenarioId/run') run(@Param('scenarioId') id:string,@Body() dto:ScenarioCommandDto,@Req() request:AuthenticatedRequest){return this.scenarios.run(id,commandIdentity(dto,request));}
  @Post(':scenarioId/replay/:runId') replay(@Param('scenarioId') id:string,@Param('runId') runId:string,@Body() dto:ScenarioCommandDto,@Req() request:AuthenticatedRequest){return this.scenarios.replay(id,runId,commandIdentity(dto,request));}
  @Get('runs/:runId') getRun(@Param('runId') id:string){return this.scenarios.getRun(id);}
  @Get('runs/:runId/export') export(@Param('runId') id:string){return this.scenarios.getRun(id);}
  @Post('runs/compare') compare(@Body() dto:CompareScenarioDto){return this.scenarios.compare(dto.leftRunId,dto.rightRunId);}
}
