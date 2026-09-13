import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.UAT_BASE_URL ?? 'http://localhost:3100/api/v1';
const apiKey = process.env.UAT_API_KEY;
const expectedActorId = process.env.UAT_ACTOR_ID ?? 'CI-UAT';
const reportPath = process.env.UAT_REPORT_PATH ?? 'outputs/uat/uat-synthetic-2025.json';
const period = 2025;
const seriesCode = 'PTBAE-IND';
const quantity = 1_000;
const price = 76_000;
const runId = `UAT-${Date.now()}`;
const checks = [];

function check(name, condition, evidence) {
  if (!condition) throw new Error(`${name} failed: ${JSON.stringify(evidence)}`);
  checks.push({ name, status: 'PASS', evidence });
}

async function api(path, { method = 'GET', body, authenticated = true, expected = [200, 201] } = {}) {
  const correlationId = randomUUID();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-correlation-id': correlationId,
      ...(authenticated && apiKey ? { 'x-api-key': apiKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : undefined; } catch { payload = text; }
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${text}`);
  }
  return { status: response.status, payload, correlationId, headers: response.headers };
}

function adminCommand(suffix) {
  return {
    idempotencyKey: `${runId}-${suffix}`,
    actorId: 'SPOOFED-ACTOR-MUST-NOT-PERSIST',
    permissionContext: 'SPOOFED-PERMISSION',
  };
}

async function run() {
  const live = await api('/health/live', { authenticated: false });
  const ready = await api('/health/ready', { authenticated: false });
  check('OPS-01 liveness and PostgreSQL readiness',
    live.payload.status === 'alive' && ready.payload.status === 'ready' && ready.payload.database === 'postgres',
    { live: live.payload, ready: ready.payload });
  check('OPS-02 correlation header', live.headers.get('x-correlation-id'), {
    correlationId: live.headers.get('x-correlation-id'),
  });

  if (apiKey) {
    const denied = await api(`/positions?seriesCode=${seriesCode}&compliancePeriod=${period}`, {
      authenticated: false, expected: [401],
    });
    check('SEC-01 unauthenticated business request rejected', denied.status === 401, denied.payload);
  }

  const positionsResponse = await api(`/positions?seriesCode=${seriesCode}&compliancePeriod=${period}`);
  const positions = positionsResponse.payload;
  check('DATA-01 synthetic 2025 population loaded', positions.length === 42, { rowCount: positions.length });
  check('DATA-02 2025 positions are verified and traceable', positions.every((item) =>
    item.sourceStatus === 'VERIFIED' && item.dataOrigin === 'SYNTHETIC' && item.sourceReference), {
    sourceStatuses: [...new Set(positions.map((item) => item.sourceStatus))],
    origins: [...new Set(positions.map((item) => item.dataOrigin))],
  });

  const seller = positions.find((item) => item.availableToSell >= quantity);
  const buyer = positions.find((item) =>
    item.availableBuyNeed >= quantity && item.availableBuyingCapacity >= quantity * price);
  check('DATA-03 UAT seller and buyer rights derived from annual positions', seller && buyer, {
    seller: seller?.participantId, sellerCapacity: seller?.availableToSell,
    buyer: buyer?.participantId, buyerNeed: buyer?.availableBuyNeed,
  });

  const provisional = (await api(`/positions?seriesCode=${seriesCode}&compliancePeriod=2026`)).payload
    .find((item) => item.availableToSell >= 1);
  check('DATA-04 provisional 2026 sample exists', provisional?.sourceStatus === 'PROVISIONAL', {
    participantId: provisional?.participantId, sourceStatus: provisional?.sourceStatus,
  });
  const provisionalSell = await api('/balance-reservations/sell', {
    method: 'POST', expected: [400], body: {
      participantId: provisional.participantId, seriesCode, compliancePeriod: 2026,
      quantity: 1, orderReference: `${runId}-PROVISIONAL-SELL`,
    },
  });
  check('DATA-05 provisional position cannot create sell rights',
    provisionalSell.payload.code === 'BAL-POSITION-NOT-VERIFIED', provisionalSell.payload);

  const existingRulesets = (await api(`/rulesets?seriesCode=${seriesCode}&compliancePeriod=${period}`)).payload;
  const version = Math.max(0, ...existingRulesets.map((item) => item.version)) + 1;
  const rulesetId = `${seriesCode}-${period}-UAT-V${version}-${Date.now()}`;
  const sessionId = `${seriesCode}-${period}-UAT-${Date.now()}`;
  const created = (await api('/rulesets', { method: 'POST', body: {
    ...adminCommand('RULESET-CREATE'), rulesetId, seriesCode, compliancePeriod: period, version,
    referencePrice: 75_000, minimumPrice: 60_000, maximumPrice: 90_000,
    tickSize: 200, lotSize: 1, marketSessionId: sessionId,
    sellCapPercentage: 100, settlementFinality: 'SRUK_ACK_RECONCILED',
    surveillancePriceDeviationBps: 2_000, surveillanceVolumeThreshold: 25_000,
    repeatedCancelThreshold: 3,
  } })).payload;
  await api(`/rulesets/${rulesetId}/approve`, { method: 'POST', body: adminCommand('RULESET-APPROVE') });
  await api(`/rulesets/${rulesetId}/activate`, { method: 'POST', body: adminCommand('RULESET-ACTIVATE') });
  await api(`/market-sessions/${sessionId}/open`, { method: 'POST', body: adminCommand('SESSION-OPEN') });
  check('GOV-01 governed UAT market activated', created.status === 'DRAFT', { rulesetId, sessionId, version });

  const sellerBefore = await api(`/positions/${seller.participantId}?seriesCode=${seriesCode}&compliancePeriod=${period}`);
  const buyerBefore = await api(`/positions/${buyer.participantId}?seriesCode=${seriesCode}&compliancePeriod=${period}`);
  const tradeCorrelation = randomUUID();
  await api('/orders', { method: 'POST', body: {
    participantId: seller.participantId, clientOrderId: `${runId}-SELL`, seriesCode,
    compliancePeriod: period, side: 'SELL', orderType: 'LIMIT', quantity,
    limitPrice: price, timeInForce: 'DAY', correlationId: tradeCorrelation,
  } });
  const buyOrder = (await api('/orders', { method: 'POST', body: {
    participantId: buyer.participantId, clientOrderId: `${runId}-BUY`, seriesCode,
    compliancePeriod: period, side: 'BUY', orderType: 'LIMIT', quantity,
    limitPrice: price, timeInForce: 'DAY', correlationId: tradeCorrelation,
  } })).payload;
  check('TRADE-01 LIMIT orders matched automatically', buyOrder.status === 'FILLED' && buyOrder.remainingQuantity === 0, buyOrder);

  const trades = (await api(`/trades?seriesCode=${seriesCode}&compliancePeriod=${period}`)).payload;
  const trade = [...trades].reverse().find((item) =>
    item.buyerParticipantId === buyer.participantId && item.sellerParticipantId === seller.participantId &&
    item.quantity === quantity && item.price === price);
  check('TRADE-02 price and trade record formed', trade, trade);

  let bundle = (await api(`/settlements/from-trade/${trade.tradeId}`, {
    method: 'POST', body: { ...adminCommand('SETTLEMENT-CREATE') },
  })).payload;
  bundle = (await api(`/settlements/${bundle.settlement.settlementId}/process`, {
    method: 'POST', body: adminCommand('SETTLEMENT-PROCESS'),
  })).payload;
  bundle = (await api(`/registry/messages/${bundle.registryMessage.registryMessageId}/send`, {
    method: 'POST', body: adminCommand('SRUK-SEND'),
  })).payload;
  bundle = (await api(`/registry/messages/${bundle.registryMessage.registryMessageId}/acknowledge`, {
    method: 'POST', body: {
      ...adminCommand('SRUK-ACK'), registryReference: `${runId}-SRUK`, acknowledgedQuantity: quantity,
    },
  })).payload;
  check('SET-01 DvP and SRUK reconciliation finalized',
    bundle.settlement.status === 'SETTLED' && bundle.registryMessage.status === 'ACKNOWLEDGED' &&
    bundle.reconciliation.status === 'MATCHED' && bundle.finalized === true, bundle);

  const sellerAfter = (await api(`/positions/${seller.participantId}?seriesCode=${seriesCode}&compliancePeriod=${period}`)).payload;
  const buyerAfter = (await api(`/positions/${buyer.participantId}?seriesCode=${seriesCode}&compliancePeriod=${period}`)).payload;
  check('SET-02 annual compliance positions updated exactly once',
    sellerAfter.acknowledgedSales - sellerBefore.payload.acknowledgedSales === quantity &&
    buyerAfter.acknowledgedPurchases - buyerBefore.payload.acknowledgedPurchases === quantity &&
    sellerAfter.executedSellPending === sellerBefore.payload.executedSellPending &&
    buyerAfter.executedBuyPending === buyerBefore.payload.executedBuyPending,
    {
      sellerBefore: sellerBefore.payload.acknowledgedSales, sellerAfter: sellerAfter.acknowledgedSales,
      buyerBefore: buyerBefore.payload.acknowledgedPurchases, buyerAfter: buyerAfter.acknowledgedPurchases,
    });

  const audits = (await api('/audit-events?entityType=RULESET&limit=500')).payload;
  const rulesetAudits = audits.filter((event) => event.entityId === rulesetId);
  check('AUD-01 authenticated identity overrides spoofed actor',
    !apiKey || (rulesetAudits.length >= 3 && rulesetAudits.every((event) => event.actorId === expectedActorId)),
    rulesetAudits.map((event) => ({ eventType: event.eventType, actorId: event.actorId })));

  await api(`/market-sessions/${sessionId}/close`, { method: 'POST', body: adminCommand('SESSION-CLOSE') });
  return { runId, status: 'PASS', executedAt: new Date().toISOString(), baseUrl, datasetPeriod: period,
    sellerParticipantId: seller.participantId, buyerParticipantId: buyer.participantId,
    tradeId: trade.tradeId, settlementId: bundle.settlement.settlementId, checks };
}

try {
  const report = await run();
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`UAT PASS: ${checks.length} checks; report ${reportPath}`);
} catch (error) {
  const report = { runId, status: 'FAIL', executedAt: new Date().toISOString(), baseUrl,
    checks, error: error instanceof Error ? error.message : String(error) };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(`UAT FAIL: ${report.error}`);
  process.exitCode = 1;
}
