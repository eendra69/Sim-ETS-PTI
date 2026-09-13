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
        sellerParticipantId: 'IND-A',
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
});
