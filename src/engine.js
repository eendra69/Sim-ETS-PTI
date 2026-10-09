import { currentUser, participants, product, quotaVintages, ruleset, scenarioDefinitions } from "./data.js";

const clone = (value) => structuredClone(value);

function participantName(id) {
  return participants.find((item) => item.id === id)?.name || id;
}

function participantById(id) {
  return participants.find((item) => item.id === id);
}

function vintageProduct(vintageYear = product.vintage_year, compliancePeriodId = product.compliance_period_id) {
  const vintage = quotaVintages.find((item) => item.vintage_year === vintageYear);
  if (vintage) {
    return {
      ...clone(product),
      ...clone(vintage),
      currency: product.currency,
      unit: product.unit,
      market_segment: product.market_segment,
      product_code: product.product_code,
      product_name: product.product_name,
      compliance_period_id: compliancePeriodId,
      target_compliance_period_label: compliancePeriodId.replace("CP-", "")
    };
  }
  return {
    ...clone(product),
    vintage_year: vintageYear,
    vintage_id: `VINT-PTBAE-IND-${vintageYear}`,
    display_label: `PTBAE-IND - Vintage ${vintageYear}`,
    product_admission_id: `ADM-PTBAE-IND-V${vintageYear}-REG`,
    fungibility_key: `PTBAE-IND:V${vintageYear}:REG`,
    effective_from: `${vintageYear}-01-01T00:00:00+07:00`,
    expires_at: vintageYear < 2027 ? "2027-12-31T23:59:59+07:00" : "2027-12-31T23:59:59+07:00"
  };
}

function scenarioRuleset(definition) {
  return {
    ...clone(ruleset),
    seed_vintage_year: definition.vintage_year || product.vintage_year,
    banking_allowed: definition.scenario_profile === "CARRYOVER_SIMULATION",
    cross_vintage_matching: false,
    scenario_profile: definition.scenario_profile || "BASELINE"
  };
}

function basePositions() {
  return participants.map((participant) => ({
    annual_position_id: `ACP-${participant.installation_id}-2027`,
    participant_id: participant.id,
    installation_id: participant.installation_id,
    compliance_period_id: product.compliance_period_id,
    name: participant.name,
    allocated_quota: participant.quota,
    verified_emission: participant.emission,
    gross_position: participant.quota - participant.emission,
    acknowledged_purchases: 0,
    acknowledged_sales: 0,
    surrendered_quantity: 0,
    holdings: clone(participant.holdings || []),
    eligible_banked_quota: 0,
    eligible_offset_applied: 0,
    holding: participant.quota,
    acknowledged_quota_position: participant.quota - participant.emission,
    compliance_position: participant.quota - participant.emission,
    net_position: participant.quota - participant.emission,
    status: "VERIFIED"
  }));
}

function baseFunds() {
  return Object.fromEntries(participants.map((participant) => [
    participant.id,
    {
      participant_id: participant.id,
      total: participant.funds,
      reserved: 0,
      available: participant.funds
    }
  ]));
}

function makeEvent(events, type, label, payload = {}) {
  const next = events.length + 1;
  events.push({
    event_id: `EVT-${String(next).padStart(3, "0")}`,
    event_type: type,
    label,
    at: `2027-09-15T09:${String(4 + Math.floor(next / 6)).padStart(2, "0")}:${String((next * 7) % 60).padStart(2, "0")}+07:00`,
    ruleset_version: ruleset.version,
    correlation_id: payload.correlation_id || `corr-${payload.scenario_id || "demo"}`,
    ...payload
  });
}

function feeFor(gross) {
  return Math.round((gross * ruleset.fee_rate_bps) / 10000);
}

function reserveFor(order) {
  const ceiling = order.order_type === "LIMIT" ? order.limit_price_idr : order.protection_price_idr;
  const gross = order.quantity * ceiling;
  return gross + feeFor(gross);
}

function makeSellOrders(definition, productContext) {
  return definition.sellBook.map((entry) => ({
    order_id: entry.order_id,
    participant_id: entry.participant_id,
    participant_name: participantName(entry.participant_id),
    source_installation_id: entry.source_installation_id || participantById(entry.participant_id)?.installation_id,
    source_compliance_period_id: productContext.compliance_period_id,
    beneficiary_installation_id: null,
    target_compliance_period_id: null,
    side: "SELL",
    order_type: "LIMIT",
    series_code: productContext.series_code,
    vintage_year: productContext.vintage_year,
    product_admission_id: productContext.product_admission_id,
    fungibility_key: productContext.fungibility_key,
    original_qty: entry.quantity,
    filled_qty: 0,
    remaining_qty: entry.quantity,
    price_idr: entry.price_idr,
    limit_price_idr: entry.price_idr,
    status: "OPEN",
    sequence: entry.sequence,
    time_in_force: "DAY"
  }));
}

export function createInitialState(scenarioId = "M-06") {
  const definition = scenarioDefinitions[scenarioId] || scenarioDefinitions["M-06"];
  const productContext = vintageProduct(
    definition.vintage_year || product.vintage_year,
    definition.order?.target_compliance_period_id || product.compliance_period_id
  );
  const rulesetContext = scenarioRuleset(definition);
  const orders = makeSellOrders(definition, productContext);
  return {
    scenarioId,
    scenarioName: definition.name,
    user: clone(currentUser),
    product: productContext,
    ruleset: rulesetContext,
    planVersion: "v0.4",
    session: {
      state: "OPEN",
      trade_date: "2027-09-15",
      server_time: "2027-09-15T09:05:00+07:00",
      timezone: "Asia/Jakarta"
    },
    positions: basePositions(),
    funds: baseFunds(),
    orders,
    triggerBook: [],
    triggerEvents: [],
    activations: [],
    trades: [],
    settlements: [],
    surrenderRequests: [],
    surrenders: [],
    registry: [],
    reconciliation: [],
    audit: [],
    alerts: [],
    notifications: [],
    events: [],
    revealedEvents: 0,
    marketData: {
      reference_price_idr: rulesetContext.reference_price_idr,
      ltp_idr: rulesetContext.reference_price_idr,
      best_bid_idr: null,
      best_ask_idr: bestAsk(orders),
      volume: 0,
      value: 0,
      vwap: 0,
      open: null,
      high: null,
      low: null,
      close: null,
      as_of: "2027-09-15T09:05:00+07:00"
    }
  };
}

export function validateDraft(state, draft) {
  const checks = [];
  const offered = state.orders
    .filter((order) => order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status))
    .reduce((sum, order) => sum + order.remaining_qty, 0);
  const exposure = reserveFor(draft);
  const dFunds = state.funds["PART-D"].available;

  const add = (code, ok, message, value = "") => checks.push({
    code,
    status: ok ? "PASS" : "FAIL",
    message,
    value
  });

  add("AUTH_SESSION_ACTIVE", state.user.status === "ACTIVE", "User dan session aktif");
  add("INSTALLATION_SCOPE_VALID", draft.beneficiary_installation_id === "INST-D-01", "Beneficiary installation berada dalam scope trader", draft.beneficiary_installation_id);
  add("SERIES_ADMITTED", state.product.series_code === "PTBAE-IND", "Seri PTBAE-IND admitted");
  add("VINTAGE_ADMITTED", draft.vintage_year === state.product.vintage_year, `Vintage ${state.product.vintage_year} aktif, belum expired, dan admitted`, draft.vintage_year);
  add("TARGET_PERIOD_VALID", draft.target_compliance_period_id === state.product.compliance_period_id, `Target compliance period ${state.product.compliance_period_id} valid`, draft.target_compliance_period_id);
  add("CROSS_VINTAGE_DISABLED", state.ruleset.cross_vintage_matching === false, "Cross-vintage matching disabled pada baseline", state.ruleset.cross_vintage_matching);
  add("MARKET_OPEN", state.session.state === "OPEN", "Market session OPEN");
  add("VALID_LOT", Number.isInteger(draft.quantity) && draft.quantity > 0, "Quantity integer > 0", draft.quantity);

  if (draft.order_type === "LIMIT") {
    add("PRICE_TICK", draft.limit_price_idr % ruleset.price_tick_idr === 0, "Harga mengikuti tick Rp200", draft.limit_price_idr);
    add("PRICE_BAND", draft.limit_price_idr >= ruleset.lower_band_idr && draft.limit_price_idr <= ruleset.upper_band_idr, "Harga di dalam band Rp60.000-Rp90.000", draft.limit_price_idr);
  }

  if (draft.order_type === "MARKET" || draft.order_type === "STOP") {
    add("MARKET_PROTECTION_REQUIRED", Boolean(draft.protection_price_idr), "Protection price tersedia dari ruleset", draft.protection_price_idr);
    add("MARKET_PROTECTION_VALID", draft.protection_price_idr <= ruleset.upper_band_idr, "Protection price valid terhadap band", draft.protection_price_idr);
  }

  if (draft.order_type === "STOP") {
    add("STOP_CONFIGURATION_VALID", draft.stop_price_idr >= ruleset.lower_band_idr && draft.stop_price_idr <= ruleset.upper_band_idr, "Stop price dan activation MARKET IOC valid", draft.stop_price_idr);
  }

  add("BUY_QTY_WITHIN_OFFER", draft.quantity <= offered, "BUY quantity tidak melampaui offered volume aktif", offered);
  add("SUFFICIENT_FUNDS", exposure <= dFunds, "Dana cukup untuk exposure + fee buffer", exposure);
  add("SELF_MATCH_CLEAR", true, "Tidak ada risiko self-match pada fixture baseline");

  return {
    validation_id: `VAL-${draft.order_id}-001`,
    outcome: checks.some((check) => check.status === "FAIL") ? "FAIL" : "PASS",
    checks,
    exposure
  };
}

export function validateSurrender(state, request) {
  const checks = [];
  const position = state.positions.find((item) => (
    item.participant_id === request.participant_id
    && item.installation_id === request.installation_id
  ));
  const vintage = quotaVintages.find((item) => item.vintage_year === request.vintage_year);
  const availableHolding = position ? position.holding - position.surrendered_quantity : 0;
  const requiredQuantity = position ? Math.max(0, -position.compliance_position) : 0;
  const hasReconciledTrades = state.trades.length > 0
    && state.trades.every((trade) => state.reconciliation.some((item) => item.trade_id === trade.trade_id && item.status === "RECONCILED"));
  const duplicate = [...state.surrenderRequests, ...state.surrenders].some((item) => item.surrender_id === request.surrender_id);

  const add = (code, ok, message, value = "") => checks.push({
    code,
    status: ok ? "PASS" : "FAIL",
    message,
    value
  });

  add("PARTICIPANT_POSITION_FOUND", Boolean(position), "Participant dan installation memiliki posisi", request.installation_id);
  add("RECONCILIATION_COMPLETE", hasReconciledTrades, "Seluruh trade terkait sudah settlement dan reconciliation", state.reconciliation.length);
  add("VINTAGE_ELIGIBLE", Boolean(vintage?.eligible_compliance_period_ids.includes(request.compliance_period_id)), "Vintage eligible untuk compliance period", request.vintage_year);
  add("COMPLIANCE_PERIOD_VALID", request.compliance_period_id === state.product.compliance_period_id, "Compliance period sesuai konteks produk", request.compliance_period_id);
  add("VALID_SURRENDER_QUANTITY", Number.isInteger(request.quantity) && request.quantity > 0, "Quantity surrender integer > 0", request.quantity);
  add("SUFFICIENT_HOLDING", request.quantity <= availableHolding, "Holding tersedia mencukupi untuk surrender", availableHolding);
  add("WITHIN_COMPLIANCE_NEED", request.quantity <= requiredQuantity, "Quantity tidak melebihi kebutuhan compliance yang tersisa", requiredQuantity);
  add("DUPLICATE_REQUEST_CLEAR", !duplicate, "Surrender request belum pernah diproses", request.surrender_id);

  return {
    validation_id: `VAL-${request.surrender_id}-001`,
    outcome: checks.some((check) => check.status === "FAIL") ? "FAIL" : "PASS",
    checks,
    available_holding: availableHolding,
    required_quantity: requiredQuantity
  };
}

export function processSurrender(state, request) {
  const submitted = {
    ...clone(request),
    status: "REQUESTED",
    requested_at: "2027-09-15T11:00:00+07:00"
  };
  makeEvent(state.events, "SurrenderRequestSubmitted", `${request.surrender_id} diajukan`, {
    scenario_id: state.scenarioId,
    surrender_id: request.surrender_id
  });

  const validation = validateSurrender(state, request);
  state.surrenderRequests.push(submitted);
  state.audit.push(audit("SurrenderRequestSubmitted", request.surrender_id, state.scenarioId));
  submitted.validation_id = validation.validation_id;
  submitted.validation = validation;

  if (validation.outcome === "FAIL") {
    submitted.status = "REJECTED";
    makeEvent(state.events, "SurrenderRejected", `${request.surrender_id} ditolak validasi`, {
      scenario_id: state.scenarioId,
      surrender_id: request.surrender_id
    });
    return { state, surrender: submitted, validation };
  }

  submitted.status = "VALIDATED";
  makeEvent(state.events, "SurrenderValidated", `${request.surrender_id} lolos validasi kuota`, {
    scenario_id: state.scenarioId,
    surrender_id: request.surrender_id
  });

  const position = state.positions.find((item) => (
    item.participant_id === request.participant_id
    && item.installation_id === request.installation_id
  ));
  position.holding -= request.quantity;
  position.surrendered_quantity += request.quantity;
  position.compliance_position += request.quantity;
  position.net_position += request.quantity;

  const surrendered = {
    ...submitted,
    status: "SURRENDERED",
    registry_ref: `SRUK-SUR-${request.surrender_id}`,
    surrendered_at: "2027-09-15T11:05:00+07:00"
  };
  state.surrenders.push(surrendered);
  submitted.status = "SURRENDERED";
  makeEvent(state.events, "Surrendered", `${request.surrender_id} berhasil diserahkan/retired`, {
    scenario_id: state.scenarioId,
    surrender_id: request.surrender_id,
    quantity: request.quantity
  });
  makeEvent(state.events, "RegistrySurrenderAcknowledged", `${surrendered.registry_ref} di-ack SRUK`, {
    scenario_id: state.scenarioId,
    surrender_id: request.surrender_id,
    registry_ref: surrendered.registry_ref
  });
  makeEvent(state.events, "CompliancePositionUpdated", "Compliance position diperbarui setelah surrender", {
    scenario_id: state.scenarioId,
    surrender_id: request.surrender_id
  });
  state.audit.push(audit("Surrendered", request.surrender_id, state.scenarioId));

  return { state, surrender: surrendered, validation };
}

export function runScenario(scenarioId) {
  const state = createInitialState(scenarioId);
  const definition = scenarioDefinitions[scenarioId];
  const incoming = {
    participant_id: "PART-D",
    participant_name: "Industri D",
    source_installation_id: null,
    beneficiary_installation_id: definition.order.beneficiary_installation_id,
    source_compliance_period_id: null,
    target_compliance_period_id: definition.order.target_compliance_period_id,
    series_code: state.product.series_code,
    vintage_year: state.product.vintage_year,
    product_admission_id: state.product.product_admission_id,
    fungibility_key: state.product.fungibility_key,
    side: "BUY",
    filled_qty: 0,
    remaining_qty: definition.order.quantity,
    status: "SUBMITTED",
    sequence: 99,
    ...clone(definition.order)
  };

  makeEvent(state.events, "OrderSubmitted", `${incoming.order_id} dikirim`, { scenario_id: scenarioId, order_id: incoming.order_id });
  const validation = validateDraft(state, incoming);
  state.validation = validation;
  state.audit.push(audit("OrderSubmitted", incoming.order_id, scenarioId));

  if (validation.outcome === "FAIL") {
    incoming.status = "REJECTED";
    state.orders.push(incoming);
    makeEvent(state.events, "OrderRejected", `${incoming.order_id} ditolak validation`, { scenario_id: scenarioId, order_id: incoming.order_id });
    return finalize(state);
  }

  incoming.status = incoming.order_type === "STOP" ? "TRIGGER_PENDING" : "OPEN";
  state.funds["PART-D"].reserved += validation.exposure;
  state.funds["PART-D"].available -= validation.exposure;
  state.orders.push(incoming);
  makeEvent(state.events, "OrderValidated", `${incoming.order_id} lolos pre-trade validation`, { scenario_id: scenarioId, order_id: incoming.order_id });
  makeEvent(state.events, "FundsReserved", `Exposure BUY direservasi ${validation.exposure}`, { scenario_id: scenarioId, order_id: incoming.order_id, value_idr: validation.exposure });

  if (incoming.order_type === "STOP") {
      state.triggerBook.push({
      entry_id: "TRG-B-S01",
      order_id: incoming.order_id,
      vintage_year: incoming.vintage_year,
      partition_key: incoming.fungibility_key,
      stop_price_idr: incoming.stop_price_idr,
      trigger_basis: incoming.trigger_basis,
      status: "TRIGGER_PENDING"
    });
    makeEvent(state.events, "StopOrderQueued", `${incoming.order_id} masuk Trigger Book privat`, { scenario_id: scenarioId, order_id: incoming.order_id });
    processStopTrigger(state, incoming, definition);
  } else {
    if (incoming.order_type === "MARKET") {
      makeEvent(state.events, "MarketSweepStarted", `${incoming.order_id} menjalankan immediate sweep IOC`, { scenario_id: scenarioId, order_id: incoming.order_id });
    }
    sweepBuyOrder(state, incoming, scenarioId);
  }

  settleAll(state, scenarioId);
  return finalize(state);
}

function processStopTrigger(state, incoming, definition) {
  for (const trigger of definition.triggerEvents) {
    if (trigger.decision !== "DUPLICATE_IGNORED") {
      state.marketData.ltp_idr = trigger.ltp;
    }
    state.triggerEvents.push({
      trigger_event_id: trigger.decision === "MET" ? "TE-S01" : `TE-${trigger.event_id}`,
      order_id: incoming.order_id,
      source_market_event_id: trigger.event_id,
      observed_value_idr: trigger.ltp,
      threshold_idr: incoming.stop_price_idr,
      decision: trigger.decision
    });
    makeEvent(state.events, "TriggerConditionObserved", `LTP ${trigger.ltp} terhadap stop ${incoming.stop_price_idr}: ${trigger.decision}`, {
      scenario_id: state.scenarioId,
      order_id: incoming.order_id,
      source_market_event_id: trigger.event_id
    });

    if (trigger.decision === "MET") {
      incoming.status = "TRIGGERED";
      makeEvent(state.events, "StopOrderTriggered", `${incoming.order_id} berubah menjadi TRIGGERED`, { scenario_id: state.scenarioId, order_id: incoming.order_id });
      incoming.status = "OPEN";
      state.activations.push({
        activation_id: "OA-S01",
        parent_order_id: incoming.order_id,
        trigger_event_id: "TE-S01",
        activation_order_type: "MARKET",
        time_in_force: "IOC",
        protection_price_idr: incoming.protection_price_idr,
        status: "ACTIVATED"
      });
      state.triggerBook = state.triggerBook.map((entry) => ({ ...entry, status: "ACTIVATED" }));
      makeEvent(state.events, "StopOrderActivated", "OA-S01 dibuat secara idempotent", { scenario_id: state.scenarioId, order_id: incoming.order_id, activation_id: "OA-S01" });
      makeEvent(state.events, "MarketSweepStarted", `${incoming.order_id} aktif sebagai MARKET IOC non-resting`, { scenario_id: state.scenarioId, order_id: incoming.order_id });
      sweepBuyOrder(state, incoming, state.scenarioId);
    }

    if (trigger.decision === "DUPLICATE_IGNORED") {
      makeEvent(state.events, "DuplicateTriggerIgnored", `${trigger.event_id} tidak membuat activation kedua`, { scenario_id: state.scenarioId, order_id: incoming.order_id });
    }
  }
}

function sweepBuyOrder(state, incoming, scenarioId) {
  const sellers = state.orders
    .filter((order) => order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status) && order.vintage_year === incoming.vintage_year && order.fungibility_key === incoming.fungibility_key)
    .sort((a, b) => a.price_idr - b.price_idr || a.sequence - b.sequence);

  for (const seller of sellers) {
    if (incoming.remaining_qty <= 0) break;
    if (incoming.order_type === "LIMIT" && seller.price_idr > incoming.limit_price_idr) break;
    if ((incoming.order_type === "MARKET" || incoming.order_type === "STOP") && seller.price_idr > incoming.protection_price_idr) break;

    const qty = Math.min(incoming.remaining_qty, seller.remaining_qty);
    if (qty <= 0) continue;
    const tradeId = `T-${incoming.order_id.split("-")[1][0]}${String(state.trades.length + 1).padStart(2, "0")}`;
    const gross = qty * seller.price_idr;
    const trade = {
      trade_id: tradeId,
      buy_order_id: incoming.order_id,
      sell_order_id: seller.order_id,
      buyer_participant_id: incoming.participant_id,
      seller_participant_id: seller.participant_id,
      beneficiary_installation_id: incoming.beneficiary_installation_id,
      source_installation_id: seller.source_installation_id,
      buyer_target_compliance_period_id: incoming.target_compliance_period_id,
      seller_source_compliance_period_id: seller.source_compliance_period_id,
      series_code: incoming.series_code,
      vintage_year: incoming.vintage_year,
      fungibility_key: incoming.fungibility_key,
      buyer: incoming.participant_name,
      seller: seller.participant_name,
      quantity: qty,
      price_idr: seller.price_idr,
      gross_value_idr: gross,
      fee_idr: feeFor(gross),
      status: "EXECUTED",
      executed_at: `2027-09-15T09:0${5 + state.trades.length}:00+07:00`,
      ruleset_version: ruleset.version
    };

    seller.remaining_qty -= qty;
    seller.filled_qty += qty;
    seller.status = seller.remaining_qty === 0 ? "FILLED" : "PARTIALLY_FILLED";
    incoming.remaining_qty -= qty;
    incoming.filled_qty += qty;
    incoming.status = incoming.remaining_qty === 0 ? "FILLED" : "PARTIALLY_FILLED";
    state.trades.push(trade);
    updateMarketDataForTrade(state, trade);
    makeEvent(state.events, "MatchEvaluated", `${incoming.order_id} matched ${seller.order_id}`, { scenario_id: scenarioId, order_id: incoming.order_id, candidate_order_id: seller.order_id });
    makeEvent(state.events, "TradeExecuted", `${trade.trade_id}: ${qty} @ ${seller.price_idr}`, { scenario_id: scenarioId, order_id: incoming.order_id, trade_id: trade.trade_id, qty, price_idr: seller.price_idr });
  }

  if (incoming.remaining_qty > 0 && (incoming.order_type === "MARKET" || incoming.order_type === "STOP")) {
    incoming.status = "CANCELLED_REMAINDER";
    makeEvent(state.events, "OrderRemainderCancelled", `${incoming.order_id} IOC remainder dibatalkan`, { scenario_id: scenarioId, order_id: incoming.order_id });
  }

  if (incoming.remaining_qty === 0) {
    incoming.status = "FILLED";
    makeEvent(state.events, "OrderFilled", `${incoming.order_id} FILLED`, { scenario_id: scenarioId, order_id: incoming.order_id });
  }
}

function updateMarketDataForTrade(state, trade) {
  const prices = [...state.trades.map((item) => item.price_idr)];
  state.marketData.ltp_idr = trade.price_idr;
  state.marketData.volume += trade.quantity;
  state.marketData.value += trade.gross_value_idr;
  state.marketData.vwap = state.marketData.value / state.marketData.volume;
  state.marketData.open = prices[0];
  state.marketData.high = Math.max(...prices);
  state.marketData.low = Math.min(...prices);
  state.marketData.close = trade.price_idr;
  state.marketData.best_ask_idr = bestAsk(state.orders);
}

function settleAll(state, scenarioId) {
  let debit = 0;
  for (const trade of state.trades) {
    debit += trade.gross_value_idr + trade.fee_idr;
    state.settlements.push({
      settlement_id: `SET-${trade.trade_id}`,
      trade_id: trade.trade_id,
      method: "VERSUS_PAYMENT",
      cycle: "T+0",
      status: "SETTLED",
      finality_at: "2027-09-15T10:00:00+07:00"
    });
    state.registry.push({
      instruction_id: `SRUK-${trade.trade_id}`,
      trade_id: trade.trade_id,
      series_code: trade.series_code,
      vintage_year: trade.vintage_year,
      source_installation_id: trade.source_installation_id,
      beneficiary_installation_id: trade.beneficiary_installation_id,
      quantity: trade.quantity,
      status: "ACKNOWLEDGED",
      registry_ref: `SRUK-SIM-${trade.trade_id}`
    });
    state.reconciliation.push({
      case_id: `REC-${trade.trade_id}`,
      trade_id: trade.trade_id,
      status: "RECONCILED",
      result: "MATCHED"
    });
    makeEvent(state.events, "SettlementCompleted", `${trade.trade_id} SETTLED`, { scenario_id: scenarioId, trade_id: trade.trade_id });
    makeEvent(state.events, "RegistryAcknowledged", `${trade.trade_id} ACK dari SRUK simulator`, { scenario_id: scenarioId, trade_id: trade.trade_id });
    makeEvent(state.events, "ReconciliationMatched", `${trade.trade_id} MATCHED dan RECONCILED`, { scenario_id: scenarioId, trade_id: trade.trade_id });
  }

  const dFunds = state.funds["PART-D"];
  dFunds.reserved = 0;
  dFunds.available = dFunds.total - debit;

  for (const trade of state.trades) {
    const buyer = state.positions.find((item) => item.participant_id === trade.buyer_participant_id);
    const seller = state.positions.find((item) => item.participant_id === trade.seller_participant_id);
    buyer.acknowledged_purchases += trade.quantity;
    buyer.holding += trade.quantity;
    seller.acknowledged_sales += trade.quantity;
    seller.holding -= trade.quantity;
  }

  state.positions = state.positions.map((position) => ({
    ...position,
    acknowledged_quota_position: position.allocated_quota + position.acknowledged_purchases - position.acknowledged_sales + position.eligible_banked_quota - position.verified_emission,
    compliance_position: position.allocated_quota + position.acknowledged_purchases - position.acknowledged_sales + position.eligible_banked_quota + position.eligible_offset_applied - position.verified_emission,
    net_position: position.allocated_quota + position.acknowledged_purchases - position.acknowledged_sales + position.eligible_banked_quota - position.verified_emission
  }));

  if (state.trades.length > 0) {
    makeEvent(state.events, "PositionUpdated", "Posisi final diperbarui setelah ACK + reconciliation", { scenario_id: scenarioId });
  }
}

function finalize(state) {
  state.summary = summarize(state);
  state.revealedEvents = state.events.length;
  return state;
}

export function summarize(state) {
  const gross = state.trades.reduce((sum, trade) => sum + trade.gross_value_idr, 0);
  const fee = state.trades.reduce((sum, trade) => sum + trade.fee_idr, 0);
  const volume = state.trades.reduce((sum, trade) => sum + trade.quantity, 0);
  return {
    scenario_id: state.scenarioId,
    volume,
    gross,
    fee,
    vwap: volume ? gross / volume : 0,
    ltp: state.marketData.ltp_idr,
    trades: state.trades.length,
    funds_available_d: state.funds["PART-D"].available
  };
}

function bestAsk(orders) {
  const prices = orders
    .filter((order) => order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status) && order.remaining_qty > 0)
    .map((order) => order.price_idr);
  return prices.length ? Math.min(...prices) : null;
}

function audit(action, entityId, scenarioId) {
  return {
    audit_id: `AUD-${action}-${entityId}`,
    actor: currentUser.display_name,
    action,
    entity_id: entityId,
    correlation_id: `corr-${scenarioId}`,
    at: "2027-09-15T09:05:00+07:00"
  };
}

export function depthRows(orders) {
  const levels = new Map();
  orders
    .filter((order) => order.side === "SELL" && ["OPEN", "PARTIALLY_FILLED"].includes(order.status) && order.remaining_qty > 0)
    .forEach((order) => {
      const current = levels.get(order.price_idr) || { price_idr: order.price_idr, order_count: 0, quantity: 0, cumulative: 0 };
      current.order_count += 1;
      current.quantity += order.remaining_qty;
      levels.set(order.price_idr, current);
    });

  let cumulative = 0;
  return [...levels.values()]
    .sort((a, b) => a.price_idr - b.price_idr)
    .map((level) => {
      cumulative += level.quantity;
      return { ...level, cumulative };
    });
}
