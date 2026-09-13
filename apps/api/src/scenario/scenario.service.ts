import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { GovernanceService } from '../governance/governance.service';
import { CreateScenarioDto, ScenarioCommandDto } from './dto/scenario.dto';
import { ScenarioDefinition, ScenarioEvent, ScenarioOrderSeed, ScenarioResult, ScenarioRun, ScenarioSeed } from './scenario.types';

interface ScenarioRow extends QueryResultRow { scenario_id:string;name:string;series_code:string;compliance_period:number;ruleset_id:string;seed:ScenarioSeed;created_by:string;created_at:Date }
interface RunRow extends QueryResultRow { run_id:string;scenario_id:string;run_number:number;result:ScenarioResult;result_hash:string;replay_of_run_id:string|null;is_deterministic_match:boolean|null;created_at:Date }

@Injectable()
export class ScenarioService implements OnModuleDestroy {
  private readonly scenarios=new Map<string,ScenarioDefinition>();
  private readonly runs=new Map<string,ScenarioRun>();
  private readonly commands=new Map<string,{aggregateId:string;fingerprint:string}>();
  private readonly pool?:Pool;

  constructor(private readonly governance:GovernanceService){
    const usePostgres=process.env.NODE_ENV!=='test'&&process.env.PERSISTENCE_MODE==='postgres';
    if(usePostgres){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required when PERSISTENCE_MODE=postgres');this.pool=new Pool({connectionString:process.env.DATABASE_URL});}
  }
  async onModuleDestroy():Promise<void>{await this.pool?.end();}

  async create(dto:CreateScenarioDto):Promise<ScenarioDefinition>{
    this.validateSeed(dto.seed); const fingerprint=JSON.stringify(dto); const candidateId=randomUUID();
    if(!this.pool){const command=this.claimMemory('SCENARIO_CREATE',dto.idempotencyKey,candidateId,fingerprint,true);if(!command.created)return this.get(command.aggregateId);
      const scenario:ScenarioDefinition={scenarioId:command.aggregateId,name:dto.name,seriesCode:dto.seriesCode,
        compliancePeriod:dto.compliancePeriod,rulesetId:dto.rulesetId,seed:structuredClone(dto.seed),createdBy:dto.actorId,createdAt:new Date().toISOString()};
      this.scenarios.set(scenario.scenarioId,scenario);await this.governance.recordAudit({eventType:'SCENARIO_CREATED',entityType:'SCENARIO',entityId:scenario.scenarioId,
        actorId:dto.actorId,permissionContext:'SCENARIO_ADMIN',afterState:scenario,correlationId:randomUUID(),rulesetId:dto.rulesetId});return structuredClone(scenario);}
    return this.withTransaction(async client=>{const command=await this.claimDb(client,'SCENARIO_CREATE',dto.idempotencyKey,candidateId,fingerprint,true);if(!command.created)return this.getDb(client,command.aggregateId);
      const result=await client.query<ScenarioRow>(`INSERT INTO scenarios(name,series_code,compliance_period,ruleset_id,seed,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [dto.name,dto.seriesCode,dto.compliancePeriod,dto.rulesetId,JSON.stringify(dto.seed),dto.actorId]);
      await client.query('UPDATE governance_commands SET aggregate_id=$3 WHERE command_scope=$1 AND idempotency_key=$2',['SCENARIO_CREATE',dto.idempotencyKey,result.rows[0]!.scenario_id]);
      await this.governance.recordAudit({eventType:'SCENARIO_CREATED',entityType:'SCENARIO',entityId:result.rows[0]!.scenario_id,actorId:dto.actorId,
        permissionContext:'SCENARIO_ADMIN',afterState:dto.seed,correlationId:randomUUID(),rulesetId:dto.rulesetId},client);return this.mapScenario(result.rows[0]!);});
  }

  async list():Promise<ScenarioDefinition[]>{if(!this.pool)return[...this.scenarios.values()].map(item=>structuredClone(item));const result=await this.pool.query<ScenarioRow>('SELECT * FROM scenarios ORDER BY created_at,scenario_id');return result.rows.map(row=>this.mapScenario(row));}
  async get(id:string):Promise<ScenarioDefinition>{if(!this.pool){const item=this.scenarios.get(id);if(!item)throw new NotFoundException(`Scenario ${id} was not found`);return structuredClone(item);}return this.getDb(this.pool,id);}
  async getRun(id:string):Promise<ScenarioRun>{if(!this.pool){const item=this.runs.get(id);if(!item)throw new NotFoundException(`Scenario run ${id} was not found`);return structuredClone(item);}const result=await this.pool.query<RunRow>('SELECT * FROM scenario_runs WHERE run_id=$1',[id]);if(!result.rows[0])throw new NotFoundException(`Scenario run ${id} was not found`);return this.mapRun(result.rows[0]);}

  async run(scenarioId:string,dto:ScenarioCommandDto):Promise<ScenarioRun>{return this.executeRun(scenarioId,dto);}
  async replay(scenarioId:string,sourceRunId:string,dto:ScenarioCommandDto):Promise<ScenarioRun>{return this.executeRun(scenarioId,dto,sourceRunId);}

  async compare(leftRunId:string,rightRunId:string){const[left,right]=await Promise.all([this.getRun(leftRunId),this.getRun(rightRunId)]);return{
    leftRunId,rightRunId,identical:left.resultHash===right.resultHash,eventCount:{left:left.result.events.length,right:right.result.events.length},
    tradeCount:{left:left.result.trades.length,right:right.result.trades.length},finalPositionsEqual:JSON.stringify(left.result.finalPositions)===JSON.stringify(right.result.finalPositions),
    firstDifferentEvent:this.firstDifference(left.result.events,right.result.events)};}

  private async executeRun(scenarioId:string,dto:ScenarioCommandDto,replayOfRunId?:string):Promise<ScenarioRun>{
    const scenario=await this.get(scenarioId);const scope=replayOfRunId?'SCENARIO_REPLAY':'SCENARIO_RUN';const fingerprint=JSON.stringify({scenarioId,replayOfRunId});const candidateId=randomUUID();
    const result=this.simulate(scenario);const hash=this.hash(result);let deterministic: boolean|undefined;
    if(replayOfRunId){const source=await this.getRun(replayOfRunId);if(source.scenarioId!==scenarioId)throw new BadRequestException('Replay source belongs to another scenario');deterministic=source.resultHash===hash;}
    if(!this.pool){const command=this.claimMemory(scope,dto.idempotencyKey,candidateId,fingerprint,true);if(!command.created)return this.getRun(command.aggregateId);
      const runNumber=[...this.runs.values()].filter(item=>item.scenarioId===scenarioId).length+1;const run:ScenarioRun={runId:command.aggregateId,scenarioId,runNumber,result,resultHash:hash,
        ...(replayOfRunId?{replayOfRunId,isDeterministicMatch:deterministic}:{}),createdAt:new Date().toISOString()};this.runs.set(run.runId,run);await this.auditRun(run,dto.actorId);return structuredClone(run);}
    return this.withTransaction(async client=>{const command=await this.claimDb(client,scope,dto.idempotencyKey,candidateId,fingerprint,true);if(!command.created)return this.getDbRun(client,command.aggregateId);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`scenario:${scenarioId}`]);
      const count=await client.query<{next:string}>('SELECT (COALESCE(max(run_number),0)+1)::text AS next FROM scenario_runs WHERE scenario_id=$1',[scenarioId]);const runNumber=Number(count.rows[0]!.next);
      const inserted=await client.query<RunRow>(`INSERT INTO scenario_runs(scenario_id,run_number,result,result_hash,replay_of_run_id,is_deterministic_match) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [scenarioId,runNumber,JSON.stringify(result),hash,replayOfRunId??null,deterministic??null]);await client.query('UPDATE governance_commands SET aggregate_id=$3 WHERE command_scope=$1 AND idempotency_key=$2',[scope,dto.idempotencyKey,inserted.rows[0]!.run_id]);
      const run=this.mapRun(inserted.rows[0]!);await this.governance.recordAudit({eventType:replayOfRunId?'SCENARIO_REPLAYED':'SCENARIO_RUN',entityType:'SCENARIO_RUN',entityId:run.runId,
        actorId:dto.actorId,permissionContext:'SCENARIO_OPERATOR',afterState:{resultHash:hash,isDeterministicMatch:deterministic},correlationId:randomUUID(),rulesetId:scenario.rulesetId},client);return run;});
  }

  private simulate(scenario:ScenarioDefinition):ScenarioResult{
    const positions={...scenario.seed.initialPositions};const book:Array<ScenarioOrderSeed&{remaining:number;sequence:number}>=[];const trades:ScenarioResult['trades']=[];const events:ScenarioEvent[]=[];let sequence=1;let tradeNumber=1;
    const emit=(eventType:ScenarioEvent['eventType'],payload:Record<string,unknown>)=>events.push({eventId:`${scenario.scenarioId}:E${sequence}`,eventSequence:sequence++,eventType,payload});
    scenario.seed.orders.forEach((order,index)=>{let remaining=order.quantity;emit('ORDER_ACCEPTED',{orderSequence:index+1,...order});const candidates=book.filter(item=>item.side!==order.side&&item.participantId!==order.participantId&&
        (order.side==='BUY'?order.price>=item.price:order.price<=item.price)).sort((a,b)=>order.side==='BUY'?a.price-b.price||a.sequence-b.sequence:b.price-a.price||a.sequence-b.sequence);
      for(const resting of candidates){if(remaining===0)break;const quantity=Math.min(remaining,resting.remaining);const buyer=order.side==='BUY'?order:resting;const seller=order.side==='SELL'?order:resting;
        const trade={tradeId:`${scenario.scenarioId}:T${tradeNumber++}`,buyerParticipantId:buyer.participantId,sellerParticipantId:seller.participantId,quantity,price:resting.price};trades.push(trade);emit('TRADE_EXECUTED',trade);
        remaining-=quantity;resting.remaining-=quantity;if(scenario.seed.autoSettle){positions[buyer.participantId]=(positions[buyer.participantId]??0)+quantity;positions[seller.participantId]=(positions[seller.participantId]??0)-quantity;
          emit('SETTLEMENT_FINALIZED',{tradeId:trade.tradeId,quantity});emit('POSITION_UPDATED',{tradeId:trade.tradeId,buyerPosition:positions[buyer.participantId],sellerPosition:positions[seller.participantId]});}}
      if(remaining>0)book.push({...order,remaining,sequence:index+1});});
    return{scenarioId:scenario.scenarioId,rulesetId:scenario.rulesetId,events,trades,finalPositions:positions};
  }

  private validateSeed(seed:ScenarioSeed):void{if(typeof seed.autoSettle!=='boolean'||!seed.initialPositions||!Array.isArray(seed.orders))throw new BadRequestException('Scenario seed is invalid');for(const order of seed.orders){if(!order.participantId||!['BUY','SELL'].includes(order.side)||!Number.isSafeInteger(order.quantity)||order.quantity<=0||!Number.isSafeInteger(order.price)||order.price<=0)throw new BadRequestException('Scenario contains an invalid order');}}
  private hash(result:ScenarioResult):string{return createHash('sha256').update(JSON.stringify(result)).digest('hex');}
  private firstDifference(left:ScenarioEvent[],right:ScenarioEvent[]){const max=Math.max(left.length,right.length);for(let i=0;i<max;i++){if(JSON.stringify(left[i])!==JSON.stringify(right[i]))return{index:i,left:left[i]??null,right:right[i]??null};}return null;}
  private async auditRun(run:ScenarioRun,actorId:string){const scenario=await this.get(run.scenarioId);await this.governance.recordAudit({eventType:run.replayOfRunId?'SCENARIO_REPLAYED':'SCENARIO_RUN',entityType:'SCENARIO_RUN',entityId:run.runId,actorId,permissionContext:'SCENARIO_OPERATOR',afterState:{resultHash:run.resultHash,isDeterministicMatch:run.isDeterministicMatch},correlationId:randomUUID(),rulesetId:scenario.rulesetId});}
  private async getDb(q:Pick<Pool,'query'>|PoolClient,id:string){const r=await q.query<ScenarioRow>('SELECT * FROM scenarios WHERE scenario_id=$1',[id]);if(!r.rows[0])throw new NotFoundException(`Scenario ${id} was not found`);return this.mapScenario(r.rows[0]);}
  private async getDbRun(q:Pick<Pool,'query'>|PoolClient,id:string){const r=await q.query<RunRow>('SELECT * FROM scenario_runs WHERE run_id=$1',[id]);if(!r.rows[0])throw new NotFoundException(`Scenario run ${id} was not found`);return this.mapRun(r.rows[0]);}
  private mapScenario(r:ScenarioRow):ScenarioDefinition{return{scenarioId:r.scenario_id,name:r.name,seriesCode:r.series_code,compliancePeriod:r.compliance_period,rulesetId:r.ruleset_id,seed:r.seed,createdBy:r.created_by,createdAt:r.created_at.toISOString()};}
  private mapRun(r:RunRow):ScenarioRun{return{runId:r.run_id,scenarioId:r.scenario_id,runNumber:r.run_number,result:r.result,resultHash:r.result_hash,...(r.replay_of_run_id?{replayOfRunId:r.replay_of_run_id}:{}),...(r.is_deterministic_match!==null?{isDeterministicMatch:r.is_deterministic_match}:{}),createdAt:r.created_at.toISOString()};}
  private claimMemory(scope:string,key:string,aggregateId:string,fingerprint:string,ignoreAggregate=false){const k=`${scope}:${key}`;const existing=this.commands.get(k);if(existing){if((!ignoreAggregate&&existing.aggregateId!==aggregateId)||existing.fingerprint!==fingerprint)throw new ConflictException('Scenario idempotency conflict');return{...existing,created:false};}this.commands.set(k,{aggregateId,fingerprint});return{aggregateId,created:true};}
  private async claimDb(client:PoolClient,scope:string,key:string,aggregateId:string,fingerprint:string,ignoreAggregate=false){const inserted=await client.query(`INSERT INTO governance_commands(command_scope,idempotency_key,aggregate_id,payload_fingerprint) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING aggregate_id`,[scope,key,aggregateId,fingerprint]);if(inserted.rows[0])return{aggregateId,created:true};const current=await client.query<{aggregate_id:string;payload_fingerprint:string}>('SELECT aggregate_id,payload_fingerprint FROM governance_commands WHERE command_scope=$1 AND idempotency_key=$2',[scope,key]);const row=current.rows[0]!;if((!ignoreAggregate&&row.aggregate_id!==aggregateId)||row.payload_fingerprint!==fingerprint)throw new ConflictException('Scenario idempotency conflict');return{aggregateId:row.aggregate_id,created:false};}
  private async withTransaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await this.pool!.connect();try{await client.query('BEGIN');const value=await fn(client);await client.query('COMMIT');return value;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}
}
