import { LimitOrderService } from '../limit-order/limit-order.service';
import { PositionBalanceService } from '../position-balance/position-balance.service';
import { SettlementService } from './settlement.service';

describe('SettlementService', () => {
  let positions: PositionBalanceService;
  let orders: LimitOrderService;
  let service: SettlementService;

  beforeEach(() => {
    positions = new PositionBalanceService();
    orders = new LimitOrderService(positions);
    service = new SettlementService(orders, positions);
  });

  async function createTrade(
    seller = 'IND-A',
    buyer = 'IND-D',
    quantity = 10_000,
    price = 75_000,
    suffix = randomSuffix(),
  ) {
    await orders.submit({
      participantId: seller,
      installationId: `INST-${seller.slice(-1)}-01`,
      vintageYear: 2027,
      clientOrderId: `ASK-${suffix}`,
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side: 'SELL',
      orderType: 'LIMIT',
      quantity,
      limitPrice: price,
      timeInForce: 'DAY',
    });
    await orders.submit({
      participantId: buyer,
      installationId: `INST-${buyer.slice(-1)}-01`,
      vintageYear: 2027,
      clientOrderId: `BUY-${suffix}`,
      seriesCode: 'PTBAE-IND',
      compliancePeriod: 2027,
      side: 'BUY',
      orderType: 'LIMIT',
      quantity,
      limitPrice: price,
      timeInForce: 'DAY',
    });
    return (await orders.listTrades('PTBAE-IND', 2027)).at(-1)!;
  }

  async function prepareAndProcess(tradeId: string, suffix = randomSuffix()) {
    const created = await service.createFromTrade(tradeId, { idempotencyKey: `create-${suffix}` });
    return service.process(created.settlement.settlementId, { idempotencyKey: `process-${suffix}` });
  }

  it('keeps an executed trade pending until settlement and SRUK finality', async () => {
    const before = await positions.getPosition('IND-D', 'PTBAE-IND', 2027);
    const trade = await createTrade();
    const executed = await positions.getPosition('IND-D', 'PTBAE-IND', 2027);
    const bundle = await prepareAndProcess(trade.tradeId);
    const afterSettlement = await positions.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(executed.acknowledgedPurchases).toBe(before.acknowledgedPurchases);
    expect(executed.executedBuyPending).toBe(10_000);
    expect(bundle.settlement.status).toBe('SETTLED');
    expect(bundle.settlement).toMatchObject({
      vintageYear: 2027,
      buyerInstallationId: 'INST-D-01',
      sellerInstallationId: 'INST-A-01',
    });
    expect(afterSettlement.netPosition).toBe(before.netPosition);
    expect(afterSettlement.executedBuyPending).toBe(10_000);
  });

  it('finalizes DvP exactly once after an exact SRUK acknowledgement', async () => {
    const trade = await createTrade();
    let bundle = await prepareAndProcess(trade.tradeId);
    bundle = await service.sendRegistry(bundle.registryMessage.registryMessageId, { idempotencyKey: 'send-once' });
    const command = {
      idempotencyKey: 'acknowledge-once',
      registryReference: 'SRUK-ACK-0001',
      acknowledgedQuantity: trade.quantity,
    };
    const finalized = await service.acknowledgeRegistry(bundle.registryMessage.registryMessageId, command);
    const retry = await service.acknowledgeRegistry(bundle.registryMessage.registryMessageId, command);
    const buyer = await positions.getPosition('IND-D', 'PTBAE-IND', 2027);
    const seller = await positions.getPosition('IND-A', 'PTBAE-IND', 2027);

    expect(finalized.finalized).toBe(true);
    expect(finalized.registryMessage.status).toBe('ACKNOWLEDGED');
    expect(finalized.reconciliation.status).toBe('MATCHED');
    expect(finalized.ledgerEntries).toHaveLength(4);
    expect(retry.ledgerEntries).toHaveLength(4);
    expect(buyer.acknowledgedPurchases).toBe(10_000);
    expect(buyer.executedBuyPending).toBe(0);
    expect(buyer.netPosition).toBe(-50_000);
    expect(seller.acknowledgedSales).toBe(10_000);
    expect(seller.executedSellPending).toBe(0);
    expect(seller.netPosition).toBe(20_000);
  });

  it('does not change positions when settlement fails and supports an idempotent retry', async () => {
    const trade = await createTrade();
    const created = await service.createFromTrade(trade.tradeId, { idempotencyKey: 'create-failure' });
    const failed = await service.fail(created.settlement.settlementId, {
      idempotencyKey: 'fail-failure',
      reason: 'Simulated cash leg failure',
    });
    const retryCommand = { idempotencyKey: 'retry-failure' };
    const pending = await service.retrySettlement(created.settlement.settlementId, retryCommand);
    const repeated = await service.retrySettlement(created.settlement.settlementId, retryCommand);
    const buyer = await positions.getPosition('IND-D', 'PTBAE-IND', 2027);

    expect(failed.settlement.status).toBe('FAILED');
    expect(pending.settlement.status).toBe('PENDING');
    expect(repeated.settlement.status).toBe('PENDING');
    expect(buyer.acknowledgedPurchases).toBe(0);
    expect(buyer.executedBuyPending).toBe(10_000);
  });

  it('opens an exception for a mismatched SRUK quantity and can retry successfully', async () => {
    const trade = await createTrade();
    let bundle = await prepareAndProcess(trade.tradeId);
    bundle = await service.sendRegistry(bundle.registryMessage.registryMessageId, { idempotencyKey: 'send-mismatch' });
    const mismatch = await service.acknowledgeRegistry(bundle.registryMessage.registryMessageId, {
      idempotencyKey: 'ack-mismatch',
      registryReference: 'SRUK-WRONG',
      acknowledgedQuantity: 9_000,
    });
    expect(mismatch.registryMessage.status).toBe('REJECTED');
    expect(mismatch.reconciliation.status).toBe('EXCEPTION');
    expect(mismatch.finalized).toBe(false);
    expect((await positions.getPosition('IND-D', 'PTBAE-IND', 2027)).acknowledgedPurchases).toBe(0);

    bundle = await service.retryRegistry(bundle.registryMessage.registryMessageId, { idempotencyKey: 'retry-mismatch' });
    bundle = await service.sendRegistry(bundle.registryMessage.registryMessageId, { idempotencyKey: 'resend-mismatch' });
    bundle = await service.acknowledgeRegistry(bundle.registryMessage.registryMessageId, {
      idempotencyKey: 'ack-corrected',
      registryReference: 'SRUK-CORRECTED',
      acknowledgedQuantity: trade.quantity,
    });
    expect(bundle.finalized).toBe(true);
    expect(bundle.registryMessage.attemptCount).toBe(2);
  });

  it('supports a traceable manual resolution of a reconciliation exception', async () => {
    const trade = await createTrade();
    let bundle = await prepareAndProcess(trade.tradeId);
    bundle = await service.sendRegistry(bundle.registryMessage.registryMessageId, { idempotencyKey: 'send-manual' });
    bundle = await service.acknowledgeRegistry(bundle.registryMessage.registryMessageId, {
      idempotencyKey: 'ack-manual-mismatch',
      registryReference: 'SRUK-MANUAL-WRONG',
      acknowledgedQuantity: 9_000,
    });

    const resolved = await service.resolveReconciliation(bundle.reconciliation.reconciliationId, {
      idempotencyKey: 'resolve-manual',
      registryReference: 'SRUK-MANUAL-CORRECTED',
      acknowledgedQuantity: trade.quantity,
    });

    expect(resolved.finalized).toBe(true);
    expect(resolved.registryMessage.status).toBe('ACKNOWLEDGED');
    expect(resolved.reconciliation.status).toBe('RESOLVED');
    expect(resolved.reconciliation.registryReference).toBe('SRUK-MANUAL-CORRECTED');
  });

  it('rejects reuse of an SRUK registry reference across trades', async () => {
    const firstTrade = await createTrade('IND-A', 'IND-D', 10_000, 75_000, 'unique-ref-a');
    const secondTrade = await createTrade('IND-B', 'IND-D', 10_000, 76_000, 'unique-ref-b');
    const bundles = [];
    for (const [index, trade] of [firstTrade, secondTrade].entries()) {
      let bundle = await prepareAndProcess(trade.tradeId, `unique-ref-${index}`);
      bundle = await service.sendRegistry(bundle.registryMessage.registryMessageId, {
        idempotencyKey: `unique-ref-send-${index}`,
      });
      bundles.push(bundle);
    }
    await service.acknowledgeRegistry(bundles[0]!.registryMessage.registryMessageId, {
      idempotencyKey: 'unique-ref-ack-a',
      registryReference: 'SRUK-UNIQUE-REFERENCE',
      acknowledgedQuantity: firstTrade.quantity,
    });

    await expect(service.acknowledgeRegistry(bundles[1]!.registryMessage.registryMessageId, {
      idempotencyKey: 'unique-ref-ack-b',
      registryReference: 'SRUK-UNIQUE-REFERENCE',
      acknowledgedQuantity: secondTrade.quantity,
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SRUK-REFERENCE-DUPLICATE' }),
    });
    expect((await service.get(bundles[1]!.settlement.settlementId)).finalized).toBe(false);
  });

  it('reaches the golden acknowledged positions A=0, B=+20k, C=+40k, D=0', async () => {
    const first = await createTrade('IND-A', 'IND-D', 30_000, 75_000, 'golden-a');
    const second = await createTrade('IND-B', 'IND-D', 30_000, 76_000, 'golden-b');
    for (const [index, trade] of [first, second].entries()) {
      let bundle = await prepareAndProcess(trade.tradeId, `golden-${index}`);
      bundle = await service.sendRegistry(bundle.registryMessage.registryMessageId, { idempotencyKey: `golden-send-${index}` });
      await service.acknowledgeRegistry(bundle.registryMessage.registryMessageId, {
        idempotencyKey: `golden-ack-${index}`,
        registryReference: `SRUK-GOLDEN-${index}`,
        acknowledgedQuantity: trade.quantity,
      });
    }
    const snapshots = await positions.listPositions('PTBAE-IND', 2027);
    expect(Object.fromEntries(snapshots.map((item) => [item.participantId, item.netPosition]))).toEqual({
      'IND-A': 0,
      'IND-B': 20_000,
      'IND-C': 40_000,
      'IND-D': 0,
    });
  });
});

function randomSuffix(): string {
  return Math.random().toString(36).slice(2);
}
