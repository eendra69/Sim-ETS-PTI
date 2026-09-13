import { GovernanceService } from '../governance/governance.service';
import { ScenarioService } from './scenario.service';

describe('ScenarioService',()=>{
  it('replays the full golden scenario with identical events and positions',async()=>{
    const service=new ScenarioService(new GovernanceService());
    const scenario=await service.create({
      idempotencyKey:'scenario-create-golden',actorId:'ADMIN-1',name:'Golden LIMIT settlement',
      seriesCode:'PTBAE-IND',compliancePeriod:2027,rulesetId:'PTBAE-IND-2027-PROTOTYPE-V1',
      seed:{initialPositions:{'IND-A':30_000,'IND-B':50_000,'IND-C':40_000,'IND-D':-60_000},autoSettle:true,
        orders:[
          {participantId:'IND-A',side:'SELL',quantity:30_000,price:75_000},
          {participantId:'IND-B',side:'SELL',quantity:30_000,price:76_000},
          {participantId:'IND-D',side:'BUY',quantity:60_000,price:76_000},
        ]},
    });
    const run=await service.run(scenario.scenarioId,{idempotencyKey:'scenario-run-golden',actorId:'OPERATOR-1'});
    const replay=await service.replay(scenario.scenarioId,run.runId,{idempotencyKey:'scenario-replay-golden',actorId:'OPERATOR-1'});
    const comparison=await service.compare(run.runId,replay.runId);

    expect(run.result.trades.map(({quantity,price})=>({quantity,price}))).toEqual([
      {quantity:30_000,price:75_000},{quantity:30_000,price:76_000},
    ]);
    expect(run.result.finalPositions).toEqual({'IND-A':0,'IND-B':20_000,'IND-C':40_000,'IND-D':0});
    expect(replay.isDeterministicMatch).toBe(true);
    expect(replay.result.events).toEqual(run.result.events);
    expect(comparison).toMatchObject({identical:true,finalPositionsEqual:true,firstDifferentEvent:null});
  });
});
