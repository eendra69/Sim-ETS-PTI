import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest as api } from '../api/client';
import type {
  AuditEvent,
  GovernedRuleset,
  Installation,
  LimitOrder,
  MarketDataSnapshot,
  MarketSession,
  OrderBook,
  PositionSnapshot,
  ProductSeriesCatalogueItem,
  QuotaVintage,
  ScenarioDefinition,
  ScenarioRun,
  SettlementBundle,
  StopOrder,
  SurveillanceAlert,
  Trade,
  TraderInstallationScope,
  TriggerBook,
  VintageHolding,
} from '../api/types';
import type { WorkspaceView } from '../app/navigation';
import { getSessionApiKey, setSessionApiKey } from '../auth/api-key';
import { FeedbackBanners } from '../components/FeedbackBanners';
import { AppShell } from '../layout/AppShell';
import { ParticipantsPage } from './ParticipantsPage';
import { ProductSeriesPage } from './ProductSeriesPage';
import { money, number, priceOrDash, signed } from '../shared/format';

interface MarketDashboardPageProps {
  view: WorkspaceView;
}

export function MarketDashboardPage({ view }: MarketDashboardPageProps) {
  const [positions, setPositions] = useState<PositionSnapshot[]>([]);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [productSeries, setProductSeries] = useState<ProductSeriesCatalogueItem[]>([]);
  const [vintages, setVintages] = useState<QuotaVintage[]>([]);
  const [holdings, setHoldings] = useState<VintageHolding[]>([]);
  const [traderScopes, setTraderScopes] = useState<TraderInstallationScope[]>([]);
  const [catalogTargetPeriod, setCatalogTargetPeriod] = useState(2027);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState(getSessionApiKey);
  const [positionPeriod, setPositionPeriod] = useState(2025);
  const [activeRuleset, setActiveRuleset] = useState<GovernedRuleset>();
  const [book, setBook] = useState<OrderBook>({ bids: [], asks: [], orders: { bids: [], asks: [] } });
  const [trades, setTrades] = useState<Trade[]>([]);
  const [triggerBook, setTriggerBook] = useState<TriggerBook>({ entries: [] });
  const [marketData, setMarketData] = useState<MarketDataSnapshot>({
    state: 'NO_TRADES',
    referencePrice: 75_000,
    lastTradedPrice: null,
    topOfBook: { bestBid: null, bestAsk: null, spread: null },
    statistics: {
      tradeCount: 0,
      volume: 0,
      notional: 0,
      vwap: null,
      open: null,
      high: null,
      low: null,
      close: null,
    },
  });
  const [settlements, setSettlements] = useState<SettlementBundle[]>([]);
  const [rulesets, setRulesets] = useState<GovernedRuleset[]>([]);
  const [marketSession, setMarketSession] = useState<MarketSession>();
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [alerts, setAlerts] = useState<SurveillanceAlert[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioDefinition[]>([]);
  const [lastScenarioRun, setLastScenarioRun] = useState<ScenarioRun>();
  const [error, setError] = useState<string>();
  const [catalogError, setCatalogError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [participantId, setParticipantId] = useState('IND-A');
  const [selectedVintageYear, setSelectedVintageYear] = useState(2024);
  const [side, setSide] = useState<'BUY' | 'SELL'>('SELL');
  const [orderType, setOrderType] = useState<'LIMIT' | 'MARKET' | 'STOP'>('LIMIT');
  const [quantity, setQuantity] = useState(5_000);
  const [limitPrice, setLimitPrice] = useState(75_000);
  const [protectionPrice, setProtectionPrice] = useState(76_000);
  const [stopPrice, setStopPrice] = useState(78_000);
  const [timeInForce, setTimeInForce] = useState<'DAY' | 'GTC' | 'IOC'>('DAY');

  const refresh = useCallback(async () => {
    try {
      const currentRuleset = await api<GovernedRuleset>('/market-rulesets/current');
      const marketQuery = `seriesCode=${encodeURIComponent(currentRuleset.seriesCode)}&compliancePeriod=${currentRuleset.compliancePeriod}&vintageYear=${selectedVintageYear}`;
      const [nextPositions, nextBook, nextTrades, nextTriggerBook, nextMarketData, nextSettlements, nextRulesets, nextSession, nextAudit, nextAlerts, nextScenarios] = await Promise.all([
        api<PositionSnapshot[]>(`/positions?seriesCode=PTBAE-IND&compliancePeriod=${positionPeriod}`),
        api<OrderBook>(`/order-book?${marketQuery}`),
        api<Trade[]>(`/trades?${marketQuery}`),
        api<TriggerBook>(`/trigger-book?${marketQuery}`),
        api<MarketDataSnapshot>(`/market-data/snapshot?${marketQuery}`),
        api<SettlementBundle[]>(`/settlements?${marketQuery}`),
        api<GovernedRuleset[]>(`/rulesets?seriesCode=${encodeURIComponent(currentRuleset.seriesCode)}&compliancePeriod=${currentRuleset.compliancePeriod}`),
        api<MarketSession>(`/market-sessions/${currentRuleset.marketSessionId}`),
        api<AuditEvent[]>('/audit-events?limit=30'),
        api<SurveillanceAlert[]>('/surveillance-alerts?limit=30'),
        api<ScenarioDefinition[]>('/scenarios'),
      ]);
      setPositions(nextPositions);
      setActiveRuleset(currentRuleset);
      setBook(nextBook);
      setTrades(nextTrades);
      setTriggerBook(nextTriggerBook);
      setMarketData(nextMarketData);
      setSettlements(nextSettlements);
      setRulesets(nextRulesets);
      setMarketSession(nextSession);
      setAuditEvents(nextAudit);
      setAlerts(nextAlerts);
      setScenarios(nextScenarios);
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Tidak dapat memuat data');
    }
  }, [positionPeriod, selectedVintageYear]);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const [nextInstallations, nextProductSeries, nextVintages, nextHoldings, nextTraderScopes] = await Promise.all([
        api<Installation[]>('/installations'),
        api<ProductSeriesCatalogueItem[]>('/product-series'),
        api<QuotaVintage[]>(`/quota-vintages?seriesCode=PTBAE-IND&targetCompliancePeriod=${catalogTargetPeriod}`),
        api<VintageHolding[]>(`/vintage-holdings?seriesCode=PTBAE-IND&targetCompliancePeriod=${catalogTargetPeriod}`),
        api<TraderInstallationScope[]>('/trader-installation-scopes'),
      ]);
      setInstallations(nextInstallations);
      setProductSeries(nextProductSeries);
      setVintages(nextVintages);
      setHoldings(nextHoldings);
      setTraderScopes(nextTraderScopes);
      setCatalogError(undefined);
    } catch (reason) {
      setCatalogError(reason instanceof Error ? reason.message : 'Tidak dapat memuat katalog');
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogTargetPeriod]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshCatalog();
  }, [refreshCatalog]);

  useEffect(() => {
    if (positions.length && !positions.some((position) => position.participantId === participantId)) {
      setParticipantId(positions[0]!.participantId);
    }
  }, [participantId, positions]);

  const eligibleVintages = useMemo(
    () => vintages.filter((item) => item.status === 'ACTIVE' && item.admission?.status === 'ACTIVE' && item.eligibility?.eligible),
    [vintages],
  );

  useEffect(() => {
    if (eligibleVintages.length && !eligibleVintages.some((item) => item.vintageYear === selectedVintageYear)) {
      setSelectedVintageYear(eligibleVintages[0]!.vintageYear);
    }
  }, [eligibleVintages, selectedVintageYear]);

  useEffect(() => {
    if (side !== 'SELL') return;
    const tradable = holdings.find((item) =>
      item.participantId === participantId && item.eligibleForTargetPeriod && item.tradableAvailableUnits > 0,
    );
    if (tradable && !holdings.some((item) =>
      item.participantId === participantId && item.vintageYear === selectedVintageYear &&
      item.eligibleForTargetPeriod && item.tradableAvailableUnits > 0,
    )) setSelectedVintageYear(tradable.vintageYear);
  }, [holdings, participantId, selectedVintageYear, side]);

  const totals = useMemo(
    () => ({
      supply: positions.reduce((sum, item) => sum + item.availableToSell, 0),
      demand: positions.reduce((sum, item) => sum + item.availableBuyNeed, 0),
    }),
    [positions],
  );

  function applyApiKey(): void {
    const applied = setSessionApiKey(apiKeyInput);
    setNotice(applied ? 'API key diterapkan untuk sesi browser ini.' : 'API key sesi dihapus.');
    void refresh();
    void refreshCatalog();
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    try {
      const order = await api<LimitOrder | StopOrder>('/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId,
          installationId: currentInstallation?.installationId,
          vintageYear: selectedVintageYear,
          clientOrderId: `WEB-${participantId}-${Date.now()}`,
          seriesCode: 'PTBAE-IND',
          compliancePeriod: 2027,
          side,
          orderType,
          quantity,
          ...(orderType === 'LIMIT'
            ? { limitPrice, timeInForce }
            : orderType === 'MARKET'
              ? { protectionPrice, timeInForce: 'IOC' }
              : {
                  stopPrice,
                  protectionPrice,
                  triggerBasis: 'LTP',
                  activationType: 'MARKET',
                  timeInForce,
                }),
        }),
      });
      setNotice(
        order.remainingQuantity === 0
          ? `${side} ${orderType} terisi penuh.`
          : `${side} ${orderType} selesai dengan status ${order.status}.`,
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Order ditolak');
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(orderId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await api<LimitOrder>(`/orders/${orderId}`, { method: 'DELETE' });
      setNotice('Order dibatalkan dan reservation dilepas.');
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Pembatalan gagal');
    } finally {
      setBusy(false);
    }
  }

  async function postTradeAction(trade: Trade, bundle?: SettlementBundle) {
    setBusy(true);
    setNotice(undefined);
    setError(undefined);
    const key = `WEB-${trade.tradeId}-${Date.now()}`;
    try {
      if (!bundle) {
        await api(`/settlements/from-trade/${trade.tradeId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: `${key}-create` }),
        });
        setNotice('Settlement instruction T+0 berhasil dibuat.');
      } else if (bundle.settlement.status === 'PENDING') {
        await api(`/settlements/${bundle.settlement.settlementId}/process`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: `${key}-process` }),
        });
        setNotice('DvP settlement berhasil diproses; transfer SRUK masih menunggu.');
      } else if (bundle.settlement.status === 'FAILED') {
        await api(`/settlements/${bundle.settlement.settlementId}/retry`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: `${key}-retry-settlement` }),
        });
        setNotice('Settlement dikembalikan ke antrean PENDING.');
      } else if (bundle.registryMessage.status === 'QUEUED' || bundle.registryMessage.status === 'RETRY') {
        await api(`/registry/messages/${bundle.registryMessage.registryMessageId}/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: `${key}-send` }),
        });
        setNotice('Instruksi transfer sudah dikirim ke simulator SRUK.');
      } else if (bundle.registryMessage.status === 'SENT') {
        await api(`/registry/messages/${bundle.registryMessage.registryMessageId}/acknowledge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: `${key}-ack`, registryReference: `SRUK-${Date.now()}`, acknowledgedQuantity: trade.quantity }),
        });
        setNotice('SRUK acknowledged dan posisi kepatuhan telah diperbarui.');
      } else if (bundle.registryMessage.status === 'REJECTED') {
        await api(`/registry/messages/${bundle.registryMessage.registryMessageId}/retry`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idempotencyKey: `${key}-retry-registry` }),
        });
        setNotice('Pesan SRUK disiapkan untuk pengiriman ulang.');
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Proses post-trade gagal');
    } finally {
      setBusy(false);
    }
  }

  function nextPostTradeAction(bundle?: SettlementBundle): string {
    if (!bundle) return 'Prepare settlement';
    if (bundle.finalized) return 'Final';
    if (bundle.settlement.status === 'REVERSED') return 'Reversed';
    if (bundle.settlement.status === 'PENDING') return 'Process DvP';
    if (bundle.settlement.status === 'FAILED') return 'Retry settlement';
    if (bundle.registryMessage.status === 'QUEUED' || bundle.registryMessage.status === 'RETRY') return 'Send to SRUK';
    if (bundle.registryMessage.status === 'SENT') return 'Acknowledge';
    if (bundle.registryMessage.status === 'REJECTED') return 'Retry SRUK';
    return 'No action';
  }

  async function sessionAction(action: 'open' | 'halt' | 'resume' | 'close') {
    if (!marketSession) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await api(`/market-sessions/${marketSession.sessionId}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: `WEB-SESSION-${action}-${Date.now()}`, actorId: 'WEB-ADMIN', permissionContext: 'MARKET_ADMIN' }),
      });
      setNotice(`Market session berhasil di-${action}.`);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perubahan session gagal'); }
    finally { setBusy(false); }
  }

  async function createRulesetDraft() {
    const active = rulesets.find((item) => item.status === 'ACTIVE');
    if (!active) return;
    const version = Math.max(...rulesets.map((item) => item.version)) + 1;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await api('/rulesets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        idempotencyKey: `WEB-RULESET-CREATE-${version}-${Date.now()}`, actorId: 'WEB-ADMIN', permissionContext: 'MARKET_ADMIN',
        rulesetId: `PTBAE-IND-2027-PROTOTYPE-V${version}`, seriesCode: active.seriesCode,
        compliancePeriod: active.compliancePeriod, version, referencePrice: active.referencePrice,
        minimumPrice: active.minimumPrice, maximumPrice: active.maximumPrice, tickSize: active.tickSize,
        lotSize: active.lotSize, marketSessionId: active.marketSessionId,
        sellCapPercentage: active.sellCapPercentage, settlementFinality: active.settlementFinality,
        surveillancePriceDeviationBps: active.surveillancePriceDeviationBps,
        surveillanceVolumeThreshold: active.surveillanceVolumeThreshold,
        repeatedCancelThreshold: active.repeatedCancelThreshold,
      }) });
      setNotice(`Draft ruleset V${version} dibuat dari konfigurasi aktif.`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Pembuatan draft gagal'); }
    finally { setBusy(false); }
  }

  async function rulesetAction(ruleset: GovernedRuleset, action: 'approve' | 'activate') {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await api(`/rulesets/${ruleset.rulesetId}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: `WEB-RULESET-${action}-${ruleset.version}-${Date.now()}`, actorId: 'WEB-ADMIN', permissionContext: 'MARKET_ADMIN' }) });
      setNotice(`Ruleset V${ruleset.version} berhasil di-${action}.`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Perubahan ruleset gagal'); }
    finally { setBusy(false); }
  }

  async function scenarioAction() {
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      let scenario = scenarios[0];
      if (!scenario) {
        scenario = await api<ScenarioDefinition>('/scenarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          idempotencyKey: `WEB-SCENARIO-CREATE-${Date.now()}`, actorId: 'WEB-ADMIN', name: 'Golden LIMIT settlement',
          seriesCode: 'PTBAE-IND', compliancePeriod: 2027, rulesetId: rulesets.find((item) => item.status === 'ACTIVE')?.rulesetId,
          seed: { initialPositions: { 'IND-A': 30000, 'IND-B': 50000, 'IND-C': 40000, 'IND-D': -60000 }, autoSettle: true,
            orders: [{ participantId: 'IND-A', side: 'SELL', quantity: 30000, price: 75000 }, { participantId: 'IND-B', side: 'SELL', quantity: 30000, price: 76000 }, { participantId: 'IND-D', side: 'BUY', quantity: 60000, price: 76000 }] },
        }) });
      }
      const run = lastScenarioRun
        ? await api<ScenarioRun>(`/scenarios/${scenario.scenarioId}/replay/${lastScenarioRun.runId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `WEB-SCENARIO-REPLAY-${Date.now()}`, actorId: 'WEB-OPERATOR' }) })
        : await api<ScenarioRun>(`/scenarios/${scenario.scenarioId}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `WEB-SCENARIO-RUN-${Date.now()}`, actorId: 'WEB-OPERATOR' }) });
      setLastScenarioRun(run); setNotice(run.isDeterministicMatch === false ? 'Replay berbeda dari source run.' : `Scenario run #${run.runNumber} selesai deterministik.`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Scenario gagal'); }
    finally { setBusy(false); }
  }

  const openOrders = [...book.orders.bids, ...book.orders.asks].sort(
    (left, right) => left.limitPrice! - right.limitPrice!,
  );
  const currentInstallation = installations.find((item) => item.participantId === participantId);
  const selectedHolding = holdings.find((item) =>
    item.participantId === participantId && item.installationId === currentInstallation?.installationId &&
    item.vintageYear === selectedVintageYear,
  );
  const sellVintageReady = side === 'BUY' || Boolean(selectedHolding?.eligibleForTargetPeriod && selectedHolding.tradableAvailableUnits >= quantity);
  const orderContextReady = Boolean(currentInstallation && eligibleVintages.some((item) => item.vintageYear === selectedVintageYear) && sellVintageReady);

  return (
    <AppShell
      participantId={participantId}
      installationId={currentInstallation?.installationId}
      vintageYear={view === 'market' ? selectedVintageYear : undefined}
      positionPeriod={positionPeriod}
      targetCompliancePeriod={view === 'market' ? activeRuleset?.compliancePeriod ?? 2027 : catalogTargetPeriod}
      sessionStatus={marketSession?.status}
      referencePrice={marketData.referencePrice}
      lastTradedPrice={marketData.lastTradedPrice}
      bestAsk={marketData.topOfBook.bestAsk?.price ?? null}
      volume={marketData.statistics.volume}
      vwap={marketData.statistics.vwap}
      rulesetVersion={activeRuleset?.version}
      authControl={(
        <div className="auth-control">
          <label htmlFor="api-key">API key sesi</label>
          <input id="api-key" type="password" placeholder="Staging API key" value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} />
          <button className="ghost" type="button" onClick={applyApiKey}>Apply</button>
        </div>
      )}
    >
      <FeedbackBanners error={catalogError ?? error} notice={notice} />
      {view === 'participants' ? (
        <ParticipantsPage
          installations={installations}
          positions={positions}
          traderScopes={traderScopes}
          holdings={holdings}
          positionPeriod={positionPeriod}
          targetCompliancePeriod={catalogTargetPeriod}
          loading={catalogLoading}
        />
      ) : view === 'product-series' ? (
        <ProductSeriesPage
          series={productSeries}
          vintages={vintages}
          holdings={holdings}
          targetCompliancePeriod={catalogTargetPeriod}
          onTargetCompliancePeriodChange={setCatalogTargetPeriod}
          loading={catalogLoading}
        />
      ) : (
      <>
      <header className="view-header" id="regular-market">
        <div>
          <h1>Pasar Reguler</h1>
          <p className="subtitle">Order, matching, market data, settlement, dan posisi kepatuhan PTBAE-IND.</p>
        </div>
        <span className="status">UAT Ready</span>
      </header>

      <section className="summary anchor-section" id="dashboard" aria-label="Ringkasan pasar">
        <article><span>Available supply</span><strong>{number.format(totals.supply)}</strong><small>tCO₂e setelah reservation</small></article>
        <article><span>Available buy need</span><strong>{number.format(totals.demand)}</strong><small>tCO₂e kebutuhan tersisa</small></article>
        <article><span>Executed volume</span><strong>{number.format(marketData.statistics.volume)}</strong><small>{marketData.state === 'TRADING' ? `LTP ${priceOrDash(marketData.lastTradedPrice)}` : 'NO TRADES · LTP belum terbentuk'}</small></article>
      </section>

      <section className="panel orders-panel anchor-section" id="ruleset">
        <div className="panel-heading compact"><div><p className="eyebrow">MARKET CONTROL</p><h2>Ruleset & session</h2></div><button className="ghost" disabled={busy} onClick={() => void createRulesetDraft()}>Clone active to draft</button></div>
        <div className="control-strip"><div><span>Session</span><strong>{marketSession?.status ?? '—'}</strong><small>{marketSession?.sessionId ?? 'loading'}</small></div><div className="control-actions">{marketSession?.status === 'OPEN' ? <><button disabled={busy} onClick={() => void sessionAction('halt')}>Halt</button><button className="cancel" disabled={busy} onClick={() => void sessionAction('close')}>Close</button></> : marketSession?.status === 'HALTED' ? <><button disabled={busy} onClick={() => void sessionAction('resume')}>Resume</button><button className="cancel" disabled={busy} onClick={() => void sessionAction('close')}>Close</button></> : <button disabled={busy} onClick={() => void sessionAction('open')}>Open</button>}</div></div>
        <div className="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Band</th><th>Tick / Lot</th><th>Sell cap</th><th>Finality</th><th></th></tr></thead><tbody>{rulesets.map((ruleset) => <tr key={ruleset.rulesetId}><td><strong>V{ruleset.version}</strong><small>{ruleset.rulesetId}</small></td><td><span className={`pill ${ruleset.status === 'ACTIVE' ? 'surplus' : ruleset.status === 'DRAFT' ? 'balanced' : ''}`}>{ruleset.status}</span></td><td>{money.format(ruleset.minimumPrice)}–{money.format(ruleset.maximumPrice)}</td><td>{number.format(ruleset.tickSize)} / {number.format(ruleset.lotSize)}</td><td>{ruleset.sellCapPercentage}%</td><td>{ruleset.settlementFinality}</td><td>{ruleset.status === 'DRAFT' ? <button className="cancel" disabled={busy} onClick={() => void rulesetAction(ruleset, 'approve')}>Approve</button> : ruleset.status === 'APPROVED' ? <button className="cancel" disabled={busy} onClick={() => void rulesetAction(ruleset, 'activate')}>Activate</button> : null}</td></tr>)}</tbody></table></div>
      </section>

      <section className="governance-grid">
        <section className="panel orders-panel anchor-section" id="scenario-lab"><div className="panel-heading compact"><div><p className="eyebrow">DETERMINISTIC REPLAY</p><h2>Scenario runner</h2></div><button className="ghost" disabled={busy} onClick={() => void scenarioAction()}>{lastScenarioRun ? 'Replay last run' : 'Run golden scenario'}</button></div>{lastScenarioRun ? <div className="scenario-result"><strong>Run #{lastScenarioRun.runNumber}</strong><span>{lastScenarioRun.result.events.length} events</span><span>{lastScenarioRun.isDeterministicMatch === undefined ? 'Initial run' : lastScenarioRun.isDeterministicMatch ? 'Identical replay' : 'Mismatch'}</span><small>{lastScenarioRun.resultHash}</small></div> : <p className="empty">Belum ada scenario run pada sesi UI ini.</p>}</section>
        <section className="panel orders-panel anchor-section" id="surveillance"><div className="panel-heading compact"><div><p className="eyebrow">SURVEILLANCE</p><h2>Open alerts</h2></div><span className="status">{alerts.length}</span></div><div className="mini-list">{alerts.length === 0 ? <p className="empty">Belum ada alert</p> : alerts.slice(-5).reverse().map((alert) => <div key={alert.alertId}><strong>{alert.alertType}</strong><span>{alert.severity}</span><small>{alert.description}</small></div>)}</div></section>
      </section>

      <section className="panel orders-panel anchor-section" id="audit">
        <div className="panel-heading compact"><div><p className="eyebrow">IMMUTABLE EVENT TRAIL</p><h2>Audit events</h2></div><p>Actor, entity, correlation ID, dan urutan event tersimpan append-only.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Seq</th><th>Event</th><th>Entity</th><th>Actor</th><th>Correlation</th><th>Time</th></tr></thead><tbody>{auditEvents.length === 0 ? <tr><td colSpan={6} className="empty-cell">Belum ada audit event</td></tr> : [...auditEvents].reverse().map((event) => <tr key={event.auditEventId}><td>#{event.eventSequence}</td><td>{event.eventType}</td><td>{event.entityType}</td><td>{event.actorId}</td><td><small>{event.correlationId}</small></td><td>{new Date(event.occurredAt).toLocaleTimeString('id-ID')}</td></tr>)}</tbody></table></div>
      </section>

      <section className="panel orders-panel anchor-section" id="market-data">
        <div className="panel-heading compact"><div><p className="eyebrow">MARKET DATA SNAPSHOT</p><h2>{marketData.state === 'TRADING' ? 'Live statistics' : 'No-trade state'}</h2></div><p>Reference price tetap terpisah dari LTP dan tidak digunakan untuk membuat trade sintetis.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Reference</th><th>LTP</th><th>Best bid</th><th>Best ask</th><th>Spread</th><th>VWAP</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead><tbody><tr><td>{money.format(marketData.referencePrice)}</td><td>{priceOrDash(marketData.lastTradedPrice)}</td><td>{priceOrDash(marketData.topOfBook.bestBid?.price ?? null)}</td><td>{priceOrDash(marketData.topOfBook.bestAsk?.price ?? null)}</td><td>{priceOrDash(marketData.topOfBook.spread)}</td><td>{priceOrDash(marketData.statistics.vwap)}</td><td>{priceOrDash(marketData.statistics.open)}</td><td>{priceOrDash(marketData.statistics.high)}</td><td>{priceOrDash(marketData.statistics.low)}</td><td>{priceOrDash(marketData.statistics.close)}</td><td>{number.format(marketData.statistics.volume)}</td></tr></tbody></table></div>
      </section>

      <section className="panel orders-panel anchor-section" id="settlement">
        <div className="panel-heading compact"><div><p className="eyebrow">T+0 DVP · SRUK ADAPTER</p><h2>Settlement & reconciliation</h2></div><p>Holding dan posisi acknowledged baru berubah setelah kuantitas SRUK cocok.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Trade / vintage</th><th>Buyer → Seller</th><th>Settlement</th><th>SRUK</th><th>Reconciliation</th><th>Attempt</th><th></th></tr></thead><tbody>{trades.length === 0 ? <tr><td colSpan={7} className="empty-cell">Belum ada trade V{selectedVintageYear} untuk diselesaikan</td></tr> : [...trades].reverse().map((trade) => { const bundle = settlements.find((item) => item.settlement.tradeId === trade.tradeId); return <tr key={trade.tradeId}><td>#{trade.tradeSequence}<small>V{trade.vintageYear} · {number.format(trade.quantity)} tCO₂e</small></td><td>{trade.buyerParticipantId} → {trade.sellerParticipantId}<small>{trade.buyerInstallationId} → {trade.sellerInstallationId}</small></td><td><span className={`pill ${bundle?.settlement.status === 'FAILED' ? 'deficit' : bundle?.settlement.status === 'SETTLED' ? 'surplus' : 'balanced'}`}>{bundle?.settlement.status ?? 'NOT PREPARED'}</span></td><td>{bundle?.registryMessage.status ?? '—'}{bundle?.registryMessage.registryReference ? <small>{bundle.registryMessage.registryReference}</small> : null}</td><td>{bundle?.reconciliation.status ?? '—'}{bundle?.reconciliation.exceptionReason ? <small>{bundle.reconciliation.exceptionReason}</small> : null}</td><td>{bundle?.registryMessage.attemptCount ?? 0}</td><td><button className="cancel post-trade-action" disabled={busy || bundle?.finalized || bundle?.settlement.status === 'REVERSED'} onClick={() => void postTradeAction(trade, bundle)}>{nextPostTradeAction(bundle)}</button></td></tr>; })}</tbody></table></div>
      </section>

      <section className="trading-grid anchor-section">
        <form className="panel ticket" onSubmit={submitOrder}>
          <div className="panel-heading compact">
            <div><p className="eyebrow">ORDER ENTRY</p><h2>{orderType} ticket</h2></div>
          </div>
          <div className="form-grid">
            <label>Peserta<select value={participantId} onChange={(event) => setParticipantId(event.target.value)}>{positions.map((position) => <option key={position.participantId} value={position.participantId}>{position.participantId} · {position.participantName}</option>)}</select></label>
            <label>Instalasi<input value={currentInstallation?.installationId ?? ''} readOnly aria-label="Instalasi penerima atau penjual" /></label>
            <label>Vintage<select value={selectedVintageYear} onChange={(event) => setSelectedVintageYear(Number(event.target.value))}>{eligibleVintages.map((vintage) => <option key={vintage.vintageId} value={vintage.vintageYear}>V{vintage.vintageYear} · {vintage.bankingStatus}</option>)}</select></label>
            <label>Jenis order<select value={orderType} onChange={(event) => { const next = event.target.value as 'LIMIT' | 'MARKET' | 'STOP'; setOrderType(next); setTimeInForce(next === 'MARKET' ? 'IOC' : 'DAY'); }}><option>LIMIT</option><option>MARKET</option><option>STOP</option></select></label>
            <label>Sisi<select value={side} onChange={(event) => setSide(event.target.value as 'BUY' | 'SELL')}><option>SELL</option><option>BUY</option></select></label>
            <label>Quantity<input type="number" min="1" step="1" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
            {orderType === 'LIMIT' ? <label>Limit price<input type="number" min="60000" max="90000" step="200" value={limitPrice} onChange={(event) => setLimitPrice(Number(event.target.value))} /></label> : <label>{side === 'BUY' ? 'Protection ceiling' : 'Protection floor'}<input type="number" min="60000" max="90000" step="200" value={protectionPrice} onChange={(event) => setProtectionPrice(Number(event.target.value))} /></label>}
            {orderType === 'STOP' ? <label>Stop price · LTP<input type="number" min="60000" max="90000" step="200" value={stopPrice} onChange={(event) => setStopPrice(Number(event.target.value))} /></label> : null}
            <label>Time in force<select value={timeInForce} disabled={orderType === 'MARKET'} onChange={(event) => setTimeInForce(event.target.value as 'DAY' | 'GTC')}><option>DAY</option><option>GTC</option>{orderType === 'MARKET' ? <option>IOC</option> : null}</select></label>
          </div>
          {side === 'SELL' ? <p className="history-note">Holding V{selectedVintageYear}: {number.format(selectedHolding?.tradableAvailableUnits ?? 0)} tCO₂e dapat dijual · {selectedHolding?.sourceStatus ?? 'TIDAK TERSEDIA'}</p> : <p className="history-note">Unit hasil beli akan dicatat untuk instalasi {currentInstallation?.installationId ?? '—'} dengan vintage V{selectedVintageYear}.</p>}
          {positionPeriod !== (activeRuleset?.compliancePeriod ?? 2027) ? <p className="history-note">Order entry dinonaktifkan saat melihat posisi historis/provisional. Pilih periode pasar aktif.</p> : null}
          <button type="submit" disabled={busy || !orderContextReady || positionPeriod !== (activeRuleset?.compliancePeriod ?? 2027)}>{busy ? 'Memproses…' : `Kirim ${side} ${orderType}`}</button>
          <small className="hint">Maximum exposure: {money.format(quantity * (orderType === 'LIMIT' ? limitPrice : protectionPrice))}</small>
        </form>

        <section className="panel book-panel">
          <div className="panel-heading compact"><div><p className="eyebrow">VISIBLE DEPTH</p><h2>Order book</h2></div><button className="ghost" type="button" onClick={() => void refresh()}>Refresh</button></div>
          <div className="book-columns">
            <div><h3>Bid</h3>{book.bids.length === 0 ? <p className="empty">Belum ada bid</p> : book.bids.map((level) => <div className="book-row bid" key={level.price}><span>{number.format(level.quantity)}</span><strong>{money.format(level.price)}</strong><small>{level.orderCount}</small></div>)}</div>
            <div><h3>Ask</h3>{book.asks.length === 0 ? <p className="empty">Belum ada ask</p> : book.asks.map((level) => <div className="book-row ask" key={level.price}><strong>{money.format(level.price)}</strong><span>{number.format(level.quantity)}</span><small>{level.orderCount}</small></div>)}</div>
          </div>
        </section>
      </section>

      <section className="panel orders-panel anchor-section" id="trigger-book">
        <div className="panel-heading compact"><div><p className="eyebrow">NON-VISIBLE CONDITIONAL QUEUE</p><h2>Trigger book</h2></div><p>STOP menunggu LTP: BUY aktif saat LTP ≥ stop, SELL saat LTP ≤ stop.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Peserta / instalasi</th><th>Vintage</th><th>Side</th><th>Stop price</th><th>Protection</th><th>Quantity</th><th>TIF</th><th></th></tr></thead><tbody>{triggerBook.entries.length === 0 ? <tr><td colSpan={8} className="empty-cell">Belum ada STOP pending untuk V{selectedVintageYear}</td></tr> : triggerBook.entries.map((order) => <tr key={order.orderId}><td>{order.participantId}<small>{order.installationId}</small></td><td>V{order.vintageYear}</td><td><span className={`side ${order.side.toLowerCase()}`}>{order.side}</span></td><td>{money.format(order.stopPrice)}</td><td>{money.format(order.protectionPrice)}</td><td>{number.format(order.remainingQuantity)}</td><td>{order.timeInForce}</td><td><button className="cancel" disabled={busy} onClick={() => void cancelOrder(order.orderId)}>Cancel</button></td></tr>)}</tbody></table></div>
      </section>

      <section className="panel orders-panel anchor-section" id="orders">
        <div className="panel-heading compact"><div><p className="eyebrow">PRICE–TIME QUEUE</p><h2>Open orders</h2></div><p>Hanya sisa order yang belum terisi yang tampil di antrean.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Peserta / instalasi</th><th>Vintage</th><th>Side</th><th>Price</th><th>Remaining</th><th>TIF</th><th></th></tr></thead><tbody>{openOrders.length === 0 ? <tr><td colSpan={7} className="empty-cell">Belum ada order aktif untuk V{selectedVintageYear}</td></tr> : openOrders.map((order) => <tr key={order.orderId}><td>{order.participantId}<small>{order.installationId}</small></td><td>V{order.vintageYear}</td><td><span className={`side ${order.side.toLowerCase()}`}>{order.side}</span></td><td>{money.format(order.limitPrice!)}</td><td>{number.format(order.remainingQuantity)}</td><td>{order.timeInForce}</td><td><button className="cancel" disabled={busy} onClick={() => void cancelOrder(order.orderId)}>Cancel</button></td></tr>)}</tbody></table></div>
      </section>

      <section className="panel orders-panel anchor-section" id="trades">
        <div className="panel-heading compact"><div><p className="eyebrow">IMMUTABLE LEDGER</p><h2>Executed trades</h2></div><p>Harga eksekusi mengikuti harga resting order.</p></div>
        <div className="table-wrap"><table><thead><tr><th>Sequence</th><th>Vintage</th><th>Buyer / instalasi</th><th>Seller / instalasi</th><th>Price</th><th>Quantity</th><th>Notional</th></tr></thead><tbody>{trades.length === 0 ? <tr><td colSpan={7} className="empty-cell">Belum ada trade untuk V{selectedVintageYear}</td></tr> : [...trades].reverse().map((trade) => <tr key={trade.tradeId}><td>#{trade.tradeSequence}</td><td>V{trade.vintageYear}</td><td>{trade.buyerParticipantId}<small>{trade.buyerInstallationId}</small></td><td>{trade.sellerParticipantId}<small>{trade.sellerInstallationId}</small></td><td>{money.format(trade.price)}</td><td>{number.format(trade.quantity)}</td><td>{money.format(trade.notional)}</td></tr>)}</tbody></table></div>
      </section>

      <section className="panel positions-panel anchor-section" id="positions">
        <div className="panel-heading"><div><p className="eyebrow">ANNUAL COMPLIANCE POSITION</p><h2>Posisi peserta</h2></div><label className="period-selector">Periode<select value={positionPeriod} onChange={(event) => setPositionPeriod(Number(event.target.value))}><option value={2024}>2024 · VERIFIED</option><option value={2025}>2025 · VERIFIED (UAT)</option><option value={2026}>2026 · PROVISIONAL</option><option value={2027}>2027 · ACTIVE MARKET</option></select></label></div>
        <div className="table-wrap"><table><thead><tr><th>Peserta</th><th>Provenance</th><th>Allocated</th><th>Emission</th><th>Net position</th><th>Executed pending</th><th>Acknowledged B/S</th><th>Available sell</th><th>Buy need</th></tr></thead><tbody>{positions.map((position) => <tr key={position.participantId}><td><strong>{position.participantName}</strong><small>{position.participantId}{position.businessType ? ` · ${position.businessType}` : ''}</small></td><td><span className={`pill ${position.sourceStatus === 'VERIFIED' ? 'surplus' : 'balanced'}`}>{position.sourceStatus}</span><small>{position.dataOrigin}{position.scaleClass ? ` · ${position.scaleClass}` : ''}</small></td><td>{number.format(position.allocatedQuota)}</td><td>{number.format(position.verifiedEmission)}</td><td><span className={`pill ${position.positionStatus.toLowerCase()}`}>{signed(position.netPosition)}</span></td><td>B {number.format(position.executedBuyPending)} / S {number.format(position.executedSellPending)}</td><td>{number.format(position.acknowledgedPurchases)} / {number.format(position.acknowledgedSales)}</td><td>{number.format(position.availableToSell)}</td><td>{number.format(position.availableBuyNeed)}</td></tr>)}</tbody></table></div>
      </section>

      <footer>Default simulator · Bukan penetapan ketentuan resmi pasar</footer>
      </>
      )}
    </AppShell>
  );
}
