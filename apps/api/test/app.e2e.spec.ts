import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Position and balance API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exposes liveness, readiness, metrics, and a correlation ID', async () => {
    const live = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(live.body.status).toBe('alive');
    expect(live.headers['x-correlation-id']).toBeDefined();
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200, {
      status: 'ready', database: 'in-memory',
    });
    const metrics = await request(app.getHttpServer()).get('/api/v1/metrics').expect(200);
    expect(metrics.text).toContain('sim_ets_http_requests_total');
  });

  it('enforces API-key authentication, roles, and trader participant scope when enabled', async () => {
    const previousMode = process.env.AUTH_MODE;
    const previousKeys = process.env.API_KEYS_JSON;
    process.env.AUTH_MODE = 'api-key';
    process.env.API_KEYS_JSON = JSON.stringify([{
      apiKey: 'uat-trader-key-at-least-16-characters',
      actorId: 'TRADER-IND-A',
      roles: ['TRADER'],
      participantId: 'IND-A',
    }]);
    try {
      await request(app.getHttpServer())
        .get('/api/v1/positions?seriesCode=PTBAE-IND&compliancePeriod=2027')
        .expect(401);
      await request(app.getHttpServer())
        .post('/api/v1/orders')
        .set('x-api-key', 'uat-trader-key-at-least-16-characters')
        .send({
          participantId: 'IND-B', clientOrderId: 'E2E-SCOPE-REJECT',
          installationId: 'INST-B-01', vintageYear: 2025,
          seriesCode: 'PTBAE-IND', compliancePeriod: 2027,
          side: 'SELL', orderType: 'LIMIT', quantity: 1_000,
          limitPrice: 75_000, timeInForce: 'DAY',
        })
        .expect(403);
    } finally {
      if (previousMode === undefined) delete process.env.AUTH_MODE;
      else process.env.AUTH_MODE = previousMode;
      if (previousKeys === undefined) delete process.env.API_KEYS_JSON;
      else process.env.API_KEYS_JSON = previousKeys;
    }
  });

  it('returns the four documented annual positions', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/positions?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);

    expect(response.body).toHaveLength(4);
    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ participantId: 'IND-A', netPosition: 30_000 }),
        expect.objectContaining({ participantId: 'IND-D', buyNeedRemaining: 60_000 }),
      ]),
    );
  });

  it('exposes vintage, admission, installation, and eligibility as separate concepts', async () => {
    const vintages = await request(app.getHttpServer())
      .get('/api/v1/quota-vintages?seriesCode=PTBAE-IND&targetCompliancePeriod=2027')
      .expect(200);
    expect(vintages.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        vintageYear: 2024,
        eligibility: expect.objectContaining({ targetCompliancePeriod: 2027, eligible: true }),
        admission: expect.objectContaining({
          fungibilityKey: 'PTBAE-IND:V2024:REG',
          crossVintageMatching: false,
        }),
      }),
      expect.objectContaining({ vintageYear: 2026 }),
    ]));

    const installations = await request(app.getHttpServer())
      .get('/api/v1/installations?participantId=IND-D')
      .expect(200);
    expect(installations.body).toEqual([
      expect.objectContaining({ participantId: 'IND-D', installationId: 'INST-D-01' }),
    ]);

    const noRule = await request(app.getHttpServer())
      .get('/api/v1/vintage-eligibility?seriesCode=PTBAE-IND&vintageYear=2025&targetCompliancePeriod=2026')
      .expect(200);
    expect(noRule.body).toMatchObject({ eligible: false, policySource: 'NO_RULE' });
  });

  it('rejects a sell reservation above verified surplus', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/balance-reservations/sell')
      .send({
        participantId: 'IND-A',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        quantity: 30_001,
        orderReference: 'E2E-ORDER-1',
      })
      .expect(400);

    expect(response.body.code).toBe('BAL-INSUFFICIENT-SELL-CAPACITY');
  });

  it('accepts a LIMIT order, shows it in the order book, then cancels it', async () => {
    const submitted = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        participantId: 'IND-A',
        installationId: 'INST-A-01',
        vintageYear: 2024,
        clientOrderId: 'E2E-LIMIT-1',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        side: 'SELL',
        orderType: 'LIMIT',
        quantity: 5_000,
        limitPrice: 70_000,
        timeInForce: 'DAY',
      })
      .expect(201);

    const book = await request(app.getHttpServer())
      .get('/api/v1/order-book?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(book.body.asks).toEqual([{ price: 70_000, quantity: 5_000, orderCount: 1 }]);

    await request(app.getHttpServer())
      .delete(`/api/v1/orders/${submitted.body.orderId}`)
      .expect(200);

    const position = await request(app.getHttpServer())
      .get('/api/v1/positions/IND-A?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(position.body.reservedSell).toBe(0);
  });

  it('rejects LIMIT orders with a missing price or STOP-only fields', async () => {
    const baseline = {
      participantId: 'IND-A',
      installationId: 'INST-A-01',
      vintageYear: 2024,
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side: 'SELL',
      orderType: 'LIMIT',
      quantity: 1_000,
      timeInForce: 'DAY',
    };

    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ ...baseline, clientOrderId: 'E2E-MISSING-PRICE' })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        ...baseline,
        clientOrderId: 'E2E-STOP-FIELD',
        limitPrice: 70_000,
        stopPrice: 71_000,
      })
      .expect(400);
  });

  it('matches crossing LIMIT orders and exposes the resulting trade', async () => {
    const baseOrder = {
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      orderType: 'LIMIT',
      quantity: 1_000,
      limitPrice: 70_000,
      timeInForce: 'DAY',
    };
    const sell = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        ...baseOrder,
        participantId: 'IND-A',
        installationId: 'INST-A-01',
        vintageYear: 2024,
        clientOrderId: 'E2E-MATCH-SELL',
        side: 'SELL',
      })
      .expect(201);
    expect(sell.body.status).toBe('OPEN');

    const buy = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        ...baseOrder,
        participantId: 'IND-D',
        installationId: 'INST-D-01',
        vintageYear: 2024,
        clientOrderId: 'E2E-MATCH-BUY',
        side: 'BUY',
      })
      .expect(201);
    expect(buy.body).toMatchObject({ status: 'FILLED', remainingQuantity: 0 });

    const trades = await request(app.getHttpServer())
      .get('/api/v1/trades?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(trades.body).toEqual([
      expect.objectContaining({
        buyerParticipantId: 'IND-D',
        buyerInstallationId: 'INST-D-01',
        sellerParticipantId: 'IND-A',
        sellerInstallationId: 'INST-A-01',
        vintageYear: 2024,
        quantity: 1_000,
        price: 70_000,
      }),
    ]);

    const resting = await request(app.getHttpServer())
      .get(`/api/v1/orders/${sell.body.orderId}`)
      .expect(200);
    expect(resting.body.status).toBe('FILLED');
  });

  it('applies IOC semantics to a protected MARKET order on an empty book', async () => {
    const command = {
      participantId: 'IND-D',
      installationId: 'INST-D-01',
      vintageYear: 2024,
      clientOrderId: 'E2E-EMPTY-MARKET',
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 1_000,
      protectionPrice: 76_000,
      timeInForce: 'IOC',
    };
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send(command)
      .expect(201);

    expect(response.body).toMatchObject({
      status: 'CANCELLED_REMAINDER',
      remainingQuantity: 1_000,
    });
    expect(response.body.limitPrice).toBeUndefined();

    const retry = await request(app.getHttpServer()).post('/api/v1/orders').send(command).expect(201);
    expect(retry.body.orderId).toBe(response.body.orderId);
  });

  it('rejects a MARKET order containing a user limit price', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        participantId: 'IND-D',
        installationId: 'INST-D-01',
        vintageYear: 2024,
        clientOrderId: 'E2E-INVALID-MARKET',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        side: 'BUY',
        orderType: 'MARKET',
        quantity: 1_000,
        limitPrice: 75_000,
        protectionPrice: 76_000,
        timeInForce: 'IOC',
      })
      .expect(400);

    expect(response.body.code).toBe('ORD-INVALID-MARKET-FIELDS');
  });

  it('keeps STOP orders in the non-visible trigger book and releases reservation on cancel', async () => {
    const submitted = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        participantId: 'IND-D',
        installationId: 'INST-D-01',
        vintageYear: 2024,
        clientOrderId: 'E2E-PENDING-STOP',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        side: 'BUY',
        orderType: 'STOP',
        quantity: 1_000,
        stopPrice: 78_000,
        protectionPrice: 80_000,
        triggerBasis: 'LTP',
        activationType: 'MARKET',
        timeInForce: 'DAY',
      })
      .expect(201);

    expect(submitted.body.status).toBe('TRIGGER_PENDING');
    const triggerBook = await request(app.getHttpServer())
      .get('/api/v1/trigger-book?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(triggerBook.body.entries).toEqual([
      expect.objectContaining({ orderId: submitted.body.orderId, stopPrice: 78_000 }),
    ]);

    await request(app.getHttpServer())
      .delete(`/api/v1/orders/${submitted.body.orderId}`)
      .expect(200);
    const position = await request(app.getHttpServer())
      .get('/api/v1/positions/IND-D?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(position.body.reservedBuyQuantity).toBe(0);
  });

  it('automatically activates STOP once from an exact-threshold trade', async () => {
    const stop = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({
        participantId: 'IND-D',
        installationId: 'INST-D-01',
        vintageYear: 2024,
        clientOrderId: 'E2E-EXACT-STOP',
        seriesCode: 'PTBAE-IND',
        compliancePeriod: 2027,
        side: 'BUY',
        orderType: 'STOP',
        quantity: 2_000,
        stopPrice: 78_000,
        protectionPrice: 80_000,
        triggerBasis: 'LTP',
        activationType: 'MARKET',
        timeInForce: 'GTC',
      })
      .expect(201);
    const base = {
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      vintageYear: 2024,
      orderType: 'LIMIT',
      limitPrice: 78_000,
      timeInForce: 'DAY',
    };
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ ...base, participantId: 'IND-A', installationId: 'INST-A-01', clientOrderId: 'E2E-TRIGGER-SOURCE', side: 'SELL', quantity: 1_000 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ ...base, participantId: 'IND-A', installationId: 'INST-A-01', clientOrderId: 'E2E-TRIGGER-LIQUIDITY', side: 'SELL', quantity: 2_000 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ ...base, participantId: 'IND-D', installationId: 'INST-D-01', clientOrderId: 'E2E-TRIGGER-TAKER', side: 'BUY', quantity: 1_000 })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .get(`/api/v1/orders/${stop.body.orderId}`)
      .expect(200);
    expect(updated.body).toMatchObject({ status: 'ACTIVATED' });

    const events = await request(app.getHttpServer())
      .get('/api/v1/trigger-events?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(events.body).toEqual([
      expect.objectContaining({
        stopOrderId: stop.body.orderId,
        observedLtp: 78_000,
        activatedOrderId: updated.body.activatedOrderId,
        activatedTradeIds: [expect.any(String)],
      }),
    ]);

    await request(app.getHttpServer())
      .post('/api/v1/trigger-book/evaluate')
      .send({ sourceTradeId: events.body[0].sourceTradeId })
      .expect(201, []);
  });

  it('exposes reproducible market-data snapshot, event feed, and replay', async () => {
    const snapshot = await request(app.getHttpServer())
      .get('/api/v1/market-data/snapshot?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);

    expect(snapshot.body).toMatchObject({
      state: 'TRADING',
      referencePrice: 75_000,
      lastTradedPrice: 78_000,
      statistics: {
        tradeCount: 3,
        volume: 4_000,
        notional: 304_000_000,
        vwap: 76_000,
        open: 70_000,
        high: 78_000,
        low: 70_000,
        close: 78_000,
      },
    });
    expect(snapshot.body.lastTrade.legs).toHaveLength(2);

    const events = await request(app.getHttpServer())
      .get(
        '/api/v1/market-data/events?seriesCode=PTBAE-IND&compliancePeriod=2027&afterTradeSequence=1&limit=1',
      )
      .expect(200);
    expect(events.body).toEqual([
      expect.objectContaining({ eventType: 'TRADE', eventSequence: 2 }),
    ]);

    const replay = await request(app.getHttpServer())
      .get('/api/v1/market-data/replay?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    expect(replay.body.points).toHaveLength(3);
    expect(replay.body.finalStatistics).toEqual(snapshot.body.statistics);
  });

  it('settles one executed trade only after an exact SRUK acknowledgement', async () => {
    const trades = await request(app.getHttpServer())
      .get('/api/v1/trades?seriesCode=PTBAE-IND&compliancePeriod=2027')
      .expect(200);
    const trade = trades.body[0];
    const created = await request(app.getHttpServer())
      .post(`/api/v1/settlements/from-trade/${trade.tradeId}`)
      .send({ idempotencyKey: 'E2E-SET-CREATE-1' })
      .expect(201);
    expect(created.body.settlement.status).toBe('PENDING');

    const processed = await request(app.getHttpServer())
      .post(`/api/v1/settlements/${created.body.settlement.settlementId}/process`)
      .send({ idempotencyKey: 'E2E-SET-PROCESS-1' })
      .expect(201);
    expect(processed.body.settlement.status).toBe('SETTLED');

    const sent = await request(app.getHttpServer())
      .post(`/api/v1/registry/messages/${created.body.registryMessage.registryMessageId}/send`)
      .send({ idempotencyKey: 'E2E-SRUK-SEND-1' })
      .expect(201);
    const before = await request(app.getHttpServer())
      .get(`/api/v1/positions/${trade.buyerParticipantId}?seriesCode=PTBAE-IND&compliancePeriod=2027`)
      .expect(200);

    const acknowledged = await request(app.getHttpServer())
      .post(`/api/v1/registry/messages/${sent.body.registryMessage.registryMessageId}/acknowledge`)
      .send({
        idempotencyKey: 'E2E-SRUK-ACK-1',
        registryReference: 'SRUK-E2E-ACK-1',
        acknowledgedQuantity: trade.quantity,
      })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get(`/api/v1/positions/${trade.buyerParticipantId}?seriesCode=PTBAE-IND&compliancePeriod=2027`)
      .expect(200);

    expect(acknowledged.body).toMatchObject({
      finalized: true,
      registryMessage: { status: 'ACKNOWLEDGED' },
      reconciliation: { status: 'MATCHED' },
    });
    expect(acknowledged.body.ledgerEntries).toHaveLength(4);
    expect(after.body.acknowledgedPurchases).toBe(before.body.acknowledgedPurchases + trade.quantity);
  });

  it('operates versioned rulesets and market session controls', async () => {
    const command = { actorId: 'E2E-ADMIN', permissionContext: 'MARKET_ADMIN' };
    const created = await request(app.getHttpServer()).post('/api/v1/rulesets').send({
      ...command, idempotencyKey: 'E2E-RULESET-CREATE-V2', rulesetId: 'PTBAE-IND-2027-E2E-V2',
      seriesCode: 'PTBAE-IND', compliancePeriod: 2027, version: 2, referencePrice: 75_000,
      minimumPrice: 60_000, maximumPrice: 90_000, tickSize: 200, lotSize: 1,
      marketSessionId: 'PTBAE-IND-2027-REGULAR', sellCapPercentage: 100,
      settlementFinality: 'SRUK_ACK_RECONCILED',
    }).expect(201);
    expect(created.body.status).toBe('DRAFT');
    await request(app.getHttpServer()).post('/api/v1/rulesets/PTBAE-IND-2027-E2E-V2/approve')
      .send({ ...command, idempotencyKey: 'E2E-RULESET-APPROVE-V2' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/rulesets/PTBAE-IND-2027-E2E-V2/activate')
      .send({ ...command, idempotencyKey: 'E2E-RULESET-ACTIVATE-V2' }).expect(201);
    const oldRuleset = await request(app.getHttpServer())
      .get('/api/v1/rulesets/PTBAE-IND-2027-PROTOTYPE-V1').expect(200);
    expect(oldRuleset.body.status).toBe('RETIRED');

    await request(app.getHttpServer()).post('/api/v1/market-sessions/PTBAE-IND-2027-REGULAR/halt')
      .send({ ...command, idempotencyKey: 'E2E-SESSION-HALT' }).expect(201);
    const blocked = await request(app.getHttpServer()).post('/api/v1/orders').send({
      participantId:'IND-C',installationId:'INST-C-01',vintageYear:2026,clientOrderId:'E2E-HALTED-ORDER',seriesCode:'PTBAE-IND',compliancePeriod:2027,
      side:'SELL',orderType:'LIMIT',quantity:1_000,limitPrice:80_000,timeInForce:'DAY',
    }).expect(409);
    expect(blocked.body.code).toBe('MARKET-HALTED');
    await request(app.getHttpServer()).post('/api/v1/market-sessions/PTBAE-IND-2027-REGULAR/resume')
      .send({ ...command, idempotencyKey: 'E2E-SESSION-RESUME' }).expect(201);
  });

  it('runs and deterministically replays a seeded scenario', async () => {
    const scenario = await request(app.getHttpServer()).post('/api/v1/scenarios').send({
      idempotencyKey:'E2E-SCENARIO-CREATE',actorId:'E2E-ADMIN',name:'E2E golden',seriesCode:'PTBAE-IND',
      compliancePeriod:2027,rulesetId:'PTBAE-IND-2027-E2E-V2',seed:{
        initialPositions:{'IND-A':30000,'IND-B':50000,'IND-C':40000,'IND-D':-60000},autoSettle:true,
        orders:[{participantId:'IND-A',side:'SELL',quantity:30000,price:75000},
          {participantId:'IND-B',side:'SELL',quantity:30000,price:76000},
          {participantId:'IND-D',side:'BUY',quantity:60000,price:76000}],
      },
    }).expect(201);
    const run = await request(app.getHttpServer()).post(`/api/v1/scenarios/${scenario.body.scenarioId}/run`)
      .send({idempotencyKey:'E2E-SCENARIO-RUN',actorId:'E2E-OPERATOR'}).expect(201);
    const replay = await request(app.getHttpServer()).post(`/api/v1/scenarios/${scenario.body.scenarioId}/replay/${run.body.runId}`)
      .send({idempotencyKey:'E2E-SCENARIO-REPLAY',actorId:'E2E-OPERATOR'}).expect(201);
    expect(replay.body.isDeterministicMatch).toBe(true);
    expect(replay.body.result.finalPositions).toEqual({'IND-A':0,'IND-B':20000,'IND-C':40000,'IND-D':0});

    const audit = await request(app.getHttpServer()).get('/api/v1/audit-events?limit=200').expect(200);
    expect(audit.body.map((event: {eventType:string})=>event.eventType)).toEqual(expect.arrayContaining([
      'RULESET_ACTIVATED','MARKET_SESSION_HALT','SCENARIO_REPLAYED',
    ]));
  });
});
