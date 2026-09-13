import { Module } from '@nestjs/common';
import { GovernanceModule } from '../governance/governance.module';
import { ScenarioController } from './scenario.controller';
import { ScenarioService } from './scenario.service';

@Module({imports:[GovernanceModule],controllers:[ScenarioController],providers:[ScenarioService]})
export class ScenarioModule{}
