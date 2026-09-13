import { LimitOrderService } from '../limit-order/limit-order.service';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { SettlementService } from '../settlement/settlement.service';
import { GovernanceService } from './governance.service';

describe('GovernanceService integration', () => {
  let governance: GovernanceService;
  let positions: PositionBalanceService;
  let orders: LimitOrderService;

  beforeEach(() => {
    governance = new GovernanceService();
    positions = new PositionBalanceService();
    orders = new LimitOrderService(positions, governance);
  });

  const admin = (key: string) => ({
    idempotencyKey: key,
    actorId: 'ADMIN-1',
    permissionContext: 'MARKET_ADMIN',
  });

  it('versions, approves, and activates rulesets without mutating history', async () => {
    const draft = await governance.createDraft({
      ...admin('ruleset-create-v2'),
      rulesetId: 'PTBAE-IND-2027-PROTOTYPE-V2',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      version: 2,
      referencePrice: 75_000,
      minimumPrice: 60_000,
      maximumPrice: 90_000,
      tickSize: 500,
      lotSize: 1_000,
      marketSessionId: 'PTBAE-IND-2027-REGULAR',
      sellCapPercentage: 80,
      settlementFinality: 'SRUK_ACK_RECONCILED',
    });
    expect(draft.status).toBe('DRAFT');
    await governance.approve(draft.rulesetId, admin('ruleset-approve-v2'));
    const active = await governance.activate(draft.rulesetId, admin('ruleset-activate-v2'));
    const historical = await governance.getRuleset('PTBAE-IND-2027-PROTOTYPE-V1');

    expect(active).toMatchObject({ status: 'ACTIVE', version: 2, tickSize: 500, lotSize: 1_000 });
    expect(historical).toMatchObject({ status: 'RETIRED', version: 1, tickSize: 200, lotSize: 1 });
    await expect(governance.updateDraft(active.rulesetId, {
      ...admin('ruleset-illegal-edit'), referencePrice: 75_000, minimumPrice: 60_000,
      maximumPrice: 90_000, tickSize: 500, lotSize: 1_000, sellCapPercentage: 100,
      settlementFinality: 'SRUK_ACK_RECONCILED', surveillancePriceDeviationBps: 2_000,
      surveillanceVolumeThreshold: 25_000, repeatedCancelThreshold: 3,
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'RULESET-IMMUTABLE' }) });
  });

  it('halts order entry without changing reservations, then resumes trading', async () => {
    const resting = await orders.submit({ participantId:'IND-A',clientOrderId:'HALT-RESTING',seriesCode:'PTBAE-IND',
      compliancePeriod:2027,side:'SELL',orderType:'LIMIT',quantity:5_000,limitPrice:75_000,timeInForce:'DAY' });
    await governance.transitionSession('PTBAE-IND-2027-REGULAR','HALT',admin('session-halt-1'));

    await expect(orders.submit({ participantId:'IND-B',clientOrderId:'HALT-BLOCKED',seriesCode:'PTBAE-IND',
      compliancePeriod:2027,side:'SELL',orderType:'LIMIT',quantity:5_000,limitPrice:75_000,timeInForce:'DAY' }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'MARKET-HALTED' }) });
    expect((await positions.getPosition('IND-A','PTBAE-IND',2027)).reservedSell).toBe(5_000);
    expect((await positions.getPosition('IND-B','PTBAE-IND',2027)).reservedSell).toBe(0);

    await governance.transitionSession('PTBAE-IND-2027-REGULAR','RESUME',admin('session-resume-1'));
    const buy = await orders.submit({ participantId:'IND-D',clientOrderId:'HALT-AFTER-RESUME',seriesCode:'PTBAE-IND',
      compliancePeriod:2027,side:'BUY',orderType:'LIMIT',quantity:5_000,limitPrice:75_000,timeInForce:'DAY' });
    expect(resting.status).toBe('OPEN');
    expect(buy.status).toBe('FILLED');
  });

  it('preserves a correlation chain from order command through position finalization', async () => {
    const correlationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await orders.submit({ participantId:'IND-A',clientOrderId:'AUDIT-SELL',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'SELL',orderType:'LIMIT',quantity:10_000,limitPrice:75_000,timeInForce:'DAY' });
    await orders.submit({ participantId:'IND-D',clientOrderId:'AUDIT-BUY',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'BUY',orderType:'LIMIT',quantity:10_000,limitPrice:75_000,timeInForce:'DAY',correlationId });
    const trade=(await orders.listTrades('PTBAE-IND',2027))[0]!;
    const settlements=new SettlementService(orders,positions,governance);
    let bundle=await settlements.createFromTrade(trade.tradeId,{idempotencyKey:'audit-create-settlement'});
    bundle=await settlements.process(bundle.settlement.settlementId,{idempotencyKey:'audit-process-settle'});
    bundle=await settlements.sendRegistry(bundle.registryMessage.registryMessageId,{idempotencyKey:'audit-send-registry'});
    await settlements.acknowledgeRegistry(bundle.registryMessage.registryMessageId,{idempotencyKey:'audit-ack-registry',registryReference:'SRUK-AUDIT-1',acknowledgedQuantity:10_000});

    const events=await governance.listAuditEvents(correlationId);
    expect(events.map(event=>event.eventType)).toEqual(expect.arrayContaining([
      'ORDER_SUBMITTED','TRADE_EXECUTED','SETTLEMENT_CREATED','POSITION_FINALIZED',
    ]));
    expect(new Set(events.map(event=>event.rulesetId))).toEqual(new Set(['PTBAE-IND-2027-PROTOTYPE-V1']));
  });

  it('creates price, volume, and repeated-cancel surveillance alerts', async () => {
    await orders.submit({participantId:'IND-A',clientOrderId:'ALERT-SELL',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'SELL',orderType:'LIMIT',quantity:30_000,limitPrice:60_000,timeInForce:'DAY'});
    await orders.submit({participantId:'IND-D',clientOrderId:'ALERT-BUY',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'BUY',orderType:'LIMIT',quantity:30_000,limitPrice:60_000,timeInForce:'DAY'});
    for(let index=1;index<=3;index++){
      const order=await orders.submit({participantId:'IND-B',clientOrderId:`CANCEL-${index}`,seriesCode:'PTBAE-IND',compliancePeriod:2027,
        side:'SELL',orderType:'LIMIT',quantity:1_000,limitPrice:80_000,timeInForce:'DAY'});
      await orders.cancel(order.orderId);
    }
    await governance.inspectSelfMatch('IND-A','00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
      'PTBAE-IND-2027-PROTOTYPE-V1');
    await governance.inspectTrigger({triggerEventId:'00000000-0000-4000-8000-000000000004',
      stopOrderId:'00000000-0000-4000-8000-000000000005',sourceTradeId:'00000000-0000-4000-8000-000000000006',
      observedLtp:90_000,triggerBasis:'LTP',activatedOrderId:'00000000-0000-4000-8000-000000000007',
      activatedTradeIds:[],correlationId:'00000000-0000-4000-8000-000000000008',triggeredAt:new Date().toISOString()},
      60_000,'PTBAE-IND-2027-PROTOTYPE-V1');
    expect((await governance.listAlerts()).map(alert=>alert.alertType)).toEqual(expect.arrayContaining([
      'UNUSUAL_PRICE','UNUSUAL_VOLUME','REPEATED_CANCEL','SELF_MATCH','TRIGGER_ANOMALY',
    ]));
  });

  it('supports configurable DvP settlement finality without double position updates', async () => {
    const draft = await governance.createDraft({ ...admin('dvp-create-v2'),
      rulesetId:'PTBAE-IND-2027-DVP-V2',seriesCode:'PTBAE-IND',compliancePeriod:2027,version:2,
      referencePrice:75_000,minimumPrice:60_000,maximumPrice:90_000,tickSize:200,lotSize:1,
      marketSessionId:'PTBAE-IND-2027-REGULAR',settlementFinality:'DVP_SETTLED' });
    await governance.approve(draft.rulesetId,admin('dvp-approve-v2'));
    await governance.activate(draft.rulesetId,admin('dvp-activate-v2'));
    await orders.submit({participantId:'IND-A',clientOrderId:'DVP-SELL',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'SELL',orderType:'LIMIT',quantity:10_000,limitPrice:75_000,timeInForce:'DAY'});
    await orders.submit({participantId:'IND-D',clientOrderId:'DVP-BUY',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'BUY',orderType:'LIMIT',quantity:10_000,limitPrice:75_000,timeInForce:'DAY'});
    const trade=(await orders.listTrades('PTBAE-IND',2027))[0]!;
    const settlements=new SettlementService(orders,positions,governance);
    let bundle=await settlements.createFromTrade(trade.tradeId,{idempotencyKey:'dvp-set-create'});
    bundle=await settlements.process(bundle.settlement.settlementId,{idempotencyKey:'dvp-set-process'});
    expect(bundle.finalized).toBe(true);
    expect(bundle.registryMessage.status).toBe('QUEUED');
    expect((await positions.getPosition('IND-D','PTBAE-IND',2027)).acknowledgedPurchases).toBe(10_000);

    bundle=await settlements.sendRegistry(bundle.registryMessage.registryMessageId,{idempotencyKey:'dvp-sruk-send'});
    bundle=await settlements.acknowledgeRegistry(bundle.registryMessage.registryMessageId,{idempotencyKey:'dvp-sruk-ack',
      registryReference:'SRUK-DVP-1',acknowledgedQuantity:10_000});
    expect(bundle.registryMessage.status).toBe('ACKNOWLEDGED');
    expect(bundle.reconciliation.status).toBe('MATCHED');
    expect(bundle.ledgerEntries).toHaveLength(4);
    expect((await positions.getPosition('IND-D','PTBAE-IND',2027)).acknowledgedPurchases).toBe(10_000);
  });
});
