import { navigation, participants, quotaVintages, scenarioDefinitions, vintageTradingExamples } from "./data.js";
import { depthRows, runScenario, validateDraft, summarize } from "./engine.js";
import { decimal, money, price, qty, statusClass } from "./format.js";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;"
}[char]));

function badge(value, extra = "") {
  return `<span class="pill ${extra}">${esc(value)}</span>`;
}

function status(value) {
  return `<span class="status ${statusClass(value)}">${esc(value)}</span>`;
}

function vintagesLabel(items) {
  return items.map((item) => item.vintage_year).sort((a, b) => a - b).join(", ");
}

function metric(label, value, note = "") {
  return `
    <div class="card card-pad metric">
      <div class="metric-label">${esc(label)}</div>
      <div>
        <div class="metric-value">${value}</div>
        ${note ? `<div class="muted small">${esc(note)}</div>` : ""}
      </div>
    </div>
  `;
}

function availableForVintage(item, vintageYear) {
  return item.holdings?.find((holding) => holding.vintage_year === vintageYear)?.available || 0;
}

function renderVintageAvailabilityTable(rows, title = "Ketersediaan Karbon per Vintage", withCard = true) {
  const vintages = quotaVintages.map((item) => item.vintage_year).sort((a, b) => a - b);
  return `
    <div class="${withCard ? "card" : "quota-post-trade-subpanel"}">
      <div class="section-title"><h2>${esc(title)}</h2>${badge(`${rows.length} industri`)}</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              <th>Installation</th>
              <th>Akses</th>
              ${vintages.map((vintage) => `<th class="num">Vintage ${vintage}</th>`).join("")}
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>${rows.map((row) => {
            const total = vintages.reduce((sum, vintage) => sum + availableForVintage(row, vintage), 0);
            return `
              <tr>
                <td>${esc(row.name)}</td>
                <td>${esc(row.installation_id)}</td>
                <td>${esc(row.side || "-")}</td>
                ${vintages.map((vintage) => `<td class="num">${qty(availableForVintage(row, vintage))}</td>`).join("")}
                <td class="num">${qty(total)}</td>
              </tr>
            `;
          }).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function routeTitle(route) {
  for (const section of navigation) {
    const item = section.items.find((entry) => entry.route === route);
    if (item) return item.title;
  }
  return "Dashboard";
}

export function renderApp(state, route, selectedScenario) {
  return `
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">ETS</div>
          <div>
            <div class="brand-title">Emission Trading System</div>
          </div>
        </div>
        <div class="top-actions">
          ${badge("SIMULASI", "sim")}
          ${badge("Fitur Pengguna")}
          ${badge(state.ruleset.version, "blue")}
          ${badge("SRUK Simulation", "warn")}
        </div>
      </header>
      ${renderSidebar(route)}
      <main class="main">
        ${renderContextStrip(state)}
        ${renderMarketStrip(state)}
        ${renderRoute(route, state, selectedScenario)}
      </main>
    </div>
    ${state.toast ? `<div class="toast">${esc(state.toast)}</div>` : ""}
  `;
}

function renderSidebar(activeRoute) {
  return `
    <aside class="sidebar">
      ${navigation.map((section) => `
        <div class="nav-section ${section.module ? `nav-module ${section.module}` : ""}">
          ${section.label ? `<div class="nav-label">${esc(section.label)}</div>` : ""}
          ${section.items.map((item) => `
            <div class="nav-item-group">
              <a class="nav-link ${item.route === activeRoute ? "active" : ""}" href="#/${item.route}">
                <span class="pill">${esc(item.icon)}</span>
                <span>${esc(item.title)}</span>
              </a>
            </div>
          `).join("")}
        </div>
      `).join("")}
    </aside>
  `;
}

function renderContextStrip(state) {
  return `
    <section class="context-strip">
      <div class="strip-group">
        ${badge(state.user.display_name)}
        ${badge("Participant: Industri D")}
        ${badge("Installation: INST-D-01")}
        ${badge(`Trader: ${state.user.trader_account_id}`)}
      </div>
      <div class="strip-group">
        ${badge(state.product.series_code, "blue")}
        ${badge(`Vintage ${state.product.vintage_year}`, "blue")}
        ${badge(`Target ${state.product.compliance_period_id}`)}
        ${badge(state.product.unit)}
      </div>
    </section>
  `;
}

function renderMarketStrip(state) {
  const md = state.marketData;
  return `
    <section class="market-strip">
      <div class="strip-group">
        ${badge(`Session ${state.session.state}`, state.session.state === "OPEN" ? "sim" : "warn")}
        ${badge(`Server ${state.session.server_time}`)}
      </div>
      <div class="strip-group">
        ${badge(`Ref ${price(md.reference_price_idr)}`)}
        ${badge(`LTP ${price(md.ltp_idr)}`, "blue")}
        ${badge(`Best Ask ${md.best_ask_idr ? price(md.best_ask_idr) : "-"}`)}
        ${badge(`Volume ${qty(md.volume)}`)}
        ${badge(`VWAP ${md.vwap ? price(Math.round(md.vwap)) : "-"}`)}
      </div>
    </section>
  `;
}

function renderRoute(route, state, selectedScenario) {
  const views = {
    dashboard: () => dashboardView(state),
    market: () => marketView(state, selectedScenario),
    "visible-order-book": () => visibleOrderBookView(state),
    orders: () => ordersView(state),
    trades: () => tradesView(state),
    portfolio: () => portfolioView(state),
    "orders-trades": () => ordersAndTradesView(state),
    "quota-post-trade": () => quotaPostTradeView(state),
    positions: () => positionsView(state),
    settlement: () => settlementView(state),
    registry: () => registryView(state),
    simulation: () => simulationView(state, selectedScenario),
    participants: () => participantsView(state),
    products: () => productsView(state),
    ruleset: () => rulesetView(state),
    surveillance: () => surveillanceView(state),
    audit: () => auditView(state)
  };
  return (views[route] || views.dashboard)();
}

function viewHeader(title, subtitle, actions = "") {
  return `
    <div class="view-header">
      <div>
        <h1>${esc(title)}</h1>
        <div class="muted">${esc(subtitle)}</div>
      </div>
      <div class="strip-group">${actions}</div>
    </div>
  `;
}

function visibleOrderBookView(state) {
  return `
    <section class="view">
      ${viewHeader("Buku Order", "Subpanel Visible Order Book untuk penawaran aktif dan trigger book participant.")}
      <div class="card">
        <div class="section-title">
          <h2>Visible Order Book</h2>
          ${badge("LIMIT only")}
        </div>
        <div class="book">
          <div>
            <div class="section-title"><h3>Ask</h3><span class="muted small">price-time</span></div>
            ${renderDepthTable(depthRows(state.orders))}
          </div>
          <div>
            <div class="section-title"><h3>Trigger Book Saya</h3><span class="muted small">nonpublic STOP</span></div>
            ${renderTriggerBook(state)}
          </div>
        </div>
      </div>
    </section>
  `;
}

function ordersView(state) {
  return `
    <section class="view">
      ${viewHeader("Buku Order", "Subpanel Orders untuk lifecycle, remaining quantity, dan status order.")}
      <div class="card">
        <div class="section-title"><h2>Orders</h2>${badge(`${state.orders.length} rows`)}</div>
        ${renderOrdersTable(state.orders)}
      </div>
    </section>
  `;
}

function dashboardView(state) {
  const s = summarize(state);
  const d = state.positions.find((item) => item.participant_id === "PART-D");
  return `
    <section class="view">
      ${viewHeader("Market Dashboard", "Ringkasan pasar, posisi participant, dan post-trade gate.", `<button class="primary" data-route="market">Buka Fitur Pengguna</button>`)}
      <div class="grid cols-4">
        ${metric("Product", state.product.series_code, `Target/source period ${state.product.compliance_period_id}`)}
        ${metric("Vintage", String(state.product.vintage_year), `Aset, terpisah dari ${state.product.compliance_period_id}`)}
        ${metric("D Buy Need", qty(Math.max(0, -d.net_position)), "Final setelah reconciliation")}
        ${metric("Matched Volume", qty(s.volume), `${s.trades} trade executed`)}
      </div>
      <div style="margin-top:14px">${renderVintageTradingExamples()}</div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="card">
          <img class="map-img" src="./assets/market-map.svg" alt="ETS market flow visual">
          <div class="card-pad">
            <h2>Flow Evidence</h2>
            <p class="muted">Order, matching, settlement, SRUK acknowledgement, reconciliation, dan position update disimpan sebagai event deterministic.</p>
          </div>
        </div>
        ${renderPositionTable(state.positions)}
      </div>
      <div style="margin-top:14px">${renderEventFeed(state.events.slice(-8))}</div>
    </section>
  `;
}

function marketView(state, selectedScenario) {
  const def = scenarioDefinitions[selectedScenario];
  const validation = validateDraft(state, { participant_id: "PART-D", ...def.order });
  const activeTab = state.marketTab || "order-book";
  return `
    <section class="view">
      ${viewHeader("Kondisi Pasar", "Order book, order ticket, profil instalasi, dan validation sheet.")}
      <div class="market-cascade-tabs" role="tablist" aria-label="Panel Kondisi Pasar">
        <div class="scenario-cascade-tabs" role="presentation">
          <button class="${activeTab === "order-book" ? "active" : ""}" data-action="scenario-tab" data-tab-group="market" data-tab="order-book" role="tab">Order Book</button>
          <button class="${activeTab === "order-ticket" ? "active" : ""}" data-action="scenario-tab" data-tab-group="market" data-tab="order-ticket" role="tab">Order Ticket</button>
          <button class="${activeTab === "profile" ? "active" : ""}" data-action="scenario-tab" data-tab-group="market" data-tab="profile" role="tab">Profil Instalasi</button>
          <button class="${activeTab === "validation" ? "active" : ""}" data-action="scenario-tab" data-tab-group="market" data-tab="validation" role="tab">Validation</button>
        </div>
        <div class="scenario-tab-panel market-tab-panel">
        ${activeTab === "order-book" ? `<div class="card">
          <div class="section-title">
            <h2>Visible Order Book</h2>
            ${badge("LIMIT only")}
          </div>
          <div class="book">
            <div>
              <div class="section-title"><h3>Ask</h3><span class="muted small">price-time</span></div>
              ${renderDepthTable(depthRows(state.orders))}
            </div>
            <div>
              <div class="section-title"><h3>Trigger Book Saya</h3><span class="muted small">nonpublic STOP</span></div>
              ${renderTriggerBook(state)}
            </div>
          </div>
        </div>` : ""}
        ${activeTab === "order-ticket" ? `<div class="card card-pad">
          <h2>Order Ticket</h2>
          ${renderTicket(def.order, state)}
          <div class="strip-group" style="margin-top:12px">
            <button data-action="validate">Validate Order</button>
            <button class="primary" data-action="run-scenario">Submit / Run</button>
            <button class="ghost" data-action="reset-scenario">Reset</button>
          </div>
        </div>` : ""}
        ${activeTab === "profile" ? `<div class="card card-pad">
          <h2>Profil Instalasi</h2>
          ${renderInstallationProfile(state)}
        </div>` : ""}
        ${activeTab === "validation" ? renderValidation(validation) : ""}
      </div>
      </div>
    </section>
  `;
}

function renderScenarioButtons(selectedScenario) {
  return `
    <select id="scenario-select" aria-label="Pilih skenario">
      ${Object.values(scenarioDefinitions).map((scenario) => `
        <option value="${scenario.id}" ${scenario.id === selectedScenario ? "selected" : ""}>${scenario.id} - ${esc(scenario.name)}</option>
      `).join("")}
    </select>
  `;
}

const scenarioStudyNotes = {
  "M-06": "LIMIT BUY yang mengambil beberapa penawaran seller sesuai prioritas harga-waktu. Cocok untuk mempelajari partial fill dan remaining order.",
  "M-17": "MARKET BUY IOC yang menyapu order book sampai quantity terpenuhi atau harga melewati protection ceiling.",
  "M-18": "STOP BUY yang menunggu LTP menyentuh stop price, lalu aktif menjadi MARKET IOC dengan protection price.",
  "M-30": "Vintage 2026 current-year untuk target CP-2027. Dipakai untuk melihat perdagangan kuota tahun berjalan tanpa cross-vintage matching.",
  "M-31": "Vintage 2025 carry-over/banked. Dipakai untuk melihat MARKET IOC pada kuota banked yang masih eligible.",
  "M-32": "Vintage 2024 banked LIMIT. Dipakai untuk melihat kuota lama yang masih eligible tetapi tetap dipisahkan per vintage."
};

function orderPriceLabel(order) {
  if (order.order_type === "LIMIT") return `Limit ${price(order.limit_price_idr)}`;
  if (order.order_type === "STOP") return `Stop ${price(order.stop_price_idr)}; proteksi ${price(order.protection_price_idr)}`;
  if (order.protection_price_idr) return `Proteksi ${price(order.protection_price_idr)}`;
  return "-";
}

function renderScenarioBrief(selectedScenario) {
  const def = scenarioDefinitions[selectedScenario];
  const order = def.order;
  const offered = def.sellBook.reduce((sum, entry) => sum + entry.quantity, 0);
  return `
    <div class="scenario-brief" style="margin-top:12px">
      <div class="muted small">Keterangan singkat</div>
      <p>${esc(scenarioStudyNotes[def.id] || def.notes || def.name)}</p>
      <div class="status-list">
        <div class="status-row"><span class="muted small">Order</span><strong>${esc(order.order_id)}</strong>${badge(`${esc(order.order_type)} ${esc(order.side)}`)}</div>
        <div class="status-row"><span class="muted small">Vintage</span><strong>${esc(order.vintage_year)}</strong>${badge(order.target_compliance_period_id)}</div>
        <div class="status-row"><span class="muted small">Jumlah</span><strong>${qty(order.quantity)} tCO2e</strong>${badge(`offered ${qty(offered)}`)}</div>
        <div class="status-row"><span class="muted small">Harga</span><strong>${esc(orderPriceLabel(order))}</strong>${badge(order.time_in_force)}</div>
      </div>
    </div>
  `;
}

function renderTicket(order, state) {
  const protection = order.protection_price_idr || "";
  return `
    <div class="ticket">
      <div class="segmented"><button class="active">BUY</button><button disabled>SELL</button></div>
      <div class="field"><label>Order ID</label><input value="${esc(order.order_id)}" readonly></div>
      <div class="field"><label>Beneficiary Installation</label><input value="${esc(order.beneficiary_installation_id || "-")}" readonly></div>
      <div class="field"><label>Series / Vintage</label><input value="PTBAE-IND / ${esc(order.vintage_year || state.product.vintage_year)}" readonly></div>
      <div class="field"><label>Target Compliance Period</label><input value="${esc(order.target_compliance_period_id || "CP-2027")}" readonly></div>
      <div class="field"><label>Order Type</label><input value="${esc(order.order_type)}" readonly></div>
      <div class="field"><label>Quantity</label><input value="${order.quantity}" readonly></div>
      ${order.order_type === "LIMIT" ? `<div class="field"><label>Limit Price</label><input value="${order.limit_price_idr}" readonly></div>` : ""}
      ${order.order_type === "STOP" ? `<div class="field"><label>Stop Price</label><input value="${order.stop_price_idr}" readonly></div>` : ""}
      ${order.order_type !== "LIMIT" ? `<div class="field"><label>Protection Ceiling</label><input value="${protection}" readonly></div>` : ""}
      <div class="field"><label>Time in Force</label><input value="${esc(order.time_in_force)}${order.activation_time_in_force ? " / IOC saat activation" : ""}" readonly></div>
    </div>
  `;
}

function renderInstallationProfile(state) {
  const d = state.positions.find((item) => item.participant_id === "PART-D");
  const funds = state.funds["PART-D"];
  return `
    <div class="status-list">
      <div class="status-row"><span class="muted small">Need</span><strong>${qty(Math.max(0, -d.net_position))} tCO2e</strong>${status(d.status)}</div>
      <div class="status-row"><span class="muted small">Installation</span><strong>${esc(d.installation_id)}</strong>${badge(state.product.compliance_period_id)}</div>
      <div class="status-row"><span class="muted small">Funds</span><strong>${money(funds.available)}</strong>${status(funds.reserved > 0 ? "PENDING" : "ACTIVE")}</div>
      <div class="status-row"><span class="muted small">Reference</span><strong>${price(state.ruleset.reference_price_idr)}</strong>${badge("band +/-20%")}</div>
      <div class="status-row"><span class="muted small">Ruleset</span><strong>${state.ruleset.version}</strong>${badge("ACTIVE", "sim")}</div>
    </div>
  `;
}

function renderDepthTable(rows) {
  if (!rows.length) return `<div class="empty">Belum ada penawaran</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Price</th><th class="num">Orders</th><th class="num">Qty</th><th class="num">Cum.</th></tr></thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td class="price-sell">${price(row.price_idr)}</td>
              <td class="num">${qty(row.order_count)}</td>
              <td class="num">${qty(row.quantity)}</td>
              <td class="num">${qty(row.cumulative)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderTriggerBook(state) {
  if (!state.triggerBook.length) return `<div class="empty">Tidak ada STOP order aktif untuk participant ini</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Order</th><th class="num">Stop</th><th>Basis</th><th>Status</th></tr></thead>
        <tbody>${state.triggerBook.map((entry) => `
          <tr><td>${entry.order_id}</td><td class="num">${price(entry.stop_price_idr)}</td><td>${entry.trigger_basis}</td><td>${status(entry.status)}</td></tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderValidation(validation) {
  const latestChecks = validation.checks.slice(-3);
  return `
    <div class="card">
      <div class="section-title">
        <h2>Pre-Trade Validation</h2>
        ${status(validation.outcome)}
      </div>
      <div class="status-list card-pad validation-list">
        ${latestChecks.map((check) => `
          <div class="status-row validation-row">
            ${status(check.status)}
            <div><strong>${esc(check.code)}</strong><div class="muted small">${esc(check.message)}</div></div>
            <span class="muted small">${esc(check.value)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}


function ordersAndTradesView(state) {
  const s = summarize(state);
  return `
    <section class="view">
      ${viewHeader("Orders & Trades", "Lifecycle, remaining quantity, trigger status, dan trade record yang terhubung ke order.")}
      <div class="grid cols-4">
        ${metric("Volume", qty(s.volume), "Matched quantity")}
        ${metric("Gross", money(s.gross), "Before fee")}
        ${metric("VWAP", s.vwap ? price(Math.round(s.vwap)) : "-", "Weighted by quantity")}
        ${metric("LTP", price(s.ltp), "Last traded price")}
      </div>
      <div class="grid cols-2" style="margin-top:14px">
        <div class="card">
          <div class="section-title"><h2>Orders</h2>${badge(`${state.orders.length} rows`)}</div>
          ${renderOrdersTable(state.orders)}
        </div>
        <div class="card">
          <div class="section-title"><h2>Trades</h2>${badge(`${state.trades.length} trades`)}</div>
          ${renderTradesTable(state.trades)}
        </div>
      </div>
    </section>
  `;
}

function renderOrdersTable(orders) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Order</th><th>Participant</th><th>Installation</th><th>Vintage</th><th>Side</th><th>Type</th><th class="num">Original</th><th class="num">Filled</th><th class="num">Remaining</th><th class="num">Price</th><th>Status</th></tr></thead>
        <tbody>${orders.map((order) => `
          <tr>
            <td>${order.order_id}</td><td>${esc(order.participant_name || order.participant_id)}</td><td>${esc(order.source_installation_id || order.beneficiary_installation_id || "-")}</td><td>${esc(order.vintage_year || "-")}</td><td>${order.side}</td><td>${order.order_type}</td>
            <td class="num">${qty(order.original_qty || order.quantity)}</td><td class="num">${qty(order.filled_qty || 0)}</td><td class="num">${qty(order.remaining_qty || 0)}</td>
            <td class="num">${order.limit_price_idr || order.price_idr || order.stop_price_idr ? price(order.limit_price_idr || order.price_idr || order.stop_price_idr) : "-"}</td>
            <td>${status(order.status)}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function tradesView(state) {
  const s = summarize(state);
  return `
    <section class="view">
      ${viewHeader("Trade Management", "Immutable trade records dan lineage order.")}
      <div class="grid cols-4">
        ${metric("Volume", qty(s.volume), "Matched quantity")}
        ${metric("Gross", money(s.gross), "Before fee")}
        ${metric("VWAP", s.vwap ? price(Math.round(s.vwap)) : "-", "Weighted by quantity")}
        ${metric("LTP", price(s.ltp), "Last traded price")}
      </div>
      <div class="card" style="margin-top:14px">
        <div class="section-title"><h2>Trades</h2>${badge(`${state.trades.length} trades`)}</div>
        ${renderTradesTable(state.trades)}
      </div>
    </section>
  `;
}

function portfolioView(state) {
  const portfolio = state.positions.filter((position) => (
    position.participant_id === state.user.participant_id
    || state.user.installation_scope.includes(position.installation_id)
  ));
  const portfolioParticipants = participants.filter((participant) => (
    participant.id === state.user.participant_id
    || state.user.installation_scope.includes(participant.installation_id)
  ));
  const holding = portfolio.reduce((sum, position) => sum + position.holding, 0);
  const netPosition = portfolio.reduce((sum, position) => sum + position.net_position, 0);
  const acknowledgedPurchases = portfolio.reduce((sum, position) => sum + position.acknowledged_purchases, 0);
  const acknowledgedSales = portfolio.reduce((sum, position) => sum + position.acknowledged_sales, 0);

  return `
    <section class="view">
      ${viewHeader("Portofolio", "Portofolio yang dimiliki Participant/Industry.")}
      <div class="grid cols-4">
        ${metric("Holding", qty(holding), "Kuota dimiliki")}
        ${metric("Net Position", qty(netPosition), "Quota - emission")}
        ${metric("Buy ACK", qty(acknowledgedPurchases), "Pembelian acknowledged")}
        ${metric("Sell ACK", qty(acknowledgedSales), "Penjualan acknowledged")}
      </div>
      <div style="margin-top:14px">
        ${renderPositionTable(portfolio, "Portofolio Participant / Industry")}
      </div>
      <div style="margin-top:14px">
        ${renderVintageAvailabilityTable(portfolioParticipants, "Ketersediaan Karbon Portofolio")}
      </div>
    </section>
  `;
}

function renderTradesTable(trades) {
  if (!trades.length) return `<div class="empty">Belum ada trade executed pada state ini</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Trade</th><th>Seller Inst.</th><th>Buyer Inst.</th><th>Vintage</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Gross</th><th>Status</th></tr></thead>
        <tbody>${trades.map((trade) => `
          <tr>
            <td>${trade.trade_id}</td><td>${esc(trade.source_installation_id)}</td><td>${esc(trade.beneficiary_installation_id)}</td><td>${esc(trade.vintage_year)}</td>
            <td class="num">${qty(trade.quantity)}</td><td class="num">${price(trade.price_idr)}</td><td class="num">${money(trade.gross_value_idr)}</td><td>${status(trade.status)}</td>
          </tr>
        `).join("")}</tbody>
      </table>
    </div>
  `;
}

function positionsView(state) {
  return `
    <section class="view">
      ${viewHeader("Annual & Market Position", "Per installation + compliance period; vintage holding dipisahkan dari posisi kepatuhan.")}
      ${renderPositionTable(state.positions)}
    </section>
  `;
}

function quotaPostTradeView(state) {
  return `
    <section class="view">
      ${viewHeader("Kuota dan Pasca Transaksi", "Terdiri dari dua sub panel untuk pengelolaan posisi, settlement, SRUK, dan rekonsiliasi.")}
      <div class="quota-post-trade-stack">
        <div class="card">
          <div class="section-title"><h2>Positions & Settlement</h2>${badge("SUB PANEL")}</div>
          <div class="grid cols-2">
            ${renderPositionTable(state.positions, "Positions", false)}
            <div class="quota-post-trade-subpanel">
              <div class="section-title"><h3>Settlement</h3>${badge(`${state.settlements.length} rows`)}</div>
              ${queueTable(state.settlements, ["settlement_id", "trade_id", "method", "cycle", "status"])}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPositionTable(positions, title = "Installation Positions", withCard = true) {
  return `
    <div class="${withCard ? "card" : "quota-post-trade-subpanel"}">
      <div class="section-title"><h2>${esc(title)}</h2>${badge("VERIFIED")}</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Installation</th><th>Participant</th><th>Period</th><th class="num">Quota</th><th class="num">Emission</th><th class="num">Buy ACK</th><th class="num">Sell ACK</th><th class="num">Holding</th><th class="num">Ack. Quota Pos.</th></tr></thead>
          <tbody>${positions.map((position) => `
            <tr>
              <td>${esc(position.installation_id)}</td><td>${esc(position.name)}</td><td>${esc(position.compliance_period_id)}</td><td class="num">${qty(position.allocated_quota)}</td><td class="num">${qty(position.verified_emission)}</td>
              <td class="num">${qty(position.acknowledged_purchases)}</td><td class="num">${qty(position.acknowledged_sales)}</td>
              <td class="num">${qty(position.holding)}</td><td class="num ${position.acknowledged_quota_position < 0 ? "price-sell" : "price-buy"}">${qty(position.acknowledged_quota_position)}</td>
            </tr>
          `).join("")}</tbody>
        </table>
      </div>
    </div>
  `;
}

function settlementView(state) {
  return queueView("Settlement Management", "T+0, trade-for-trade, versus payment.", state.settlements, ["settlement_id", "trade_id", "method", "cycle", "status"]);
}

function registryView(state) {
  return `
    <section class="view">
      ${viewHeader("SRUK & Rekonsiliasi", "Instruction, ACK, retry, dan kasus rekonsiliasi.")}
      <div class="grid cols-2">
        ${queueCard("Registry Queue", state.registry, ["instruction_id", "trade_id", "vintage_year", "source_installation_id", "beneficiary_installation_id", "quantity", "status", "registry_ref"])}
        ${queueCard("Reconciliation", state.reconciliation, ["case_id", "trade_id", "result", "status"])}
      </div>
    </section>
  `;
}

function queueView(title, subtitle, rows, keys) {
  return `<section class="view">${viewHeader(title, subtitle)}${queueCard(title, rows, keys)}</section>`;
}

function queueTable(rows, keys) {
  return rows.length ? `
    <div class="table-wrap"><table>
      <thead><tr>${keys.map((key) => `<th>${esc(key)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${key === "status" ? status(row[key]) : esc(row[key])}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
  ` : `<div class="empty">Queue kosong pada state ini</div>`;
}

function queueCard(title, rows, keys) {
  return `
    <div class="card">
      <div class="section-title"><h2>${esc(title)}</h2>${badge(`${rows.length} rows`)}</div>
      ${queueTable(rows, keys)}
    </div>
  `;
}

function simulationView(state, selectedScenario) {
  const s = summarize(state);
  const studyEvents = state.studyEvents || state.events;
  const totalStudyEvents = studyEvents.length;
  const revealedEvents = Math.min(state.revealedEvents || 0, totalStudyEvents);
  const shownEvents = state.events.length
    ? state.events.slice(0, state.revealedEvents || state.events.length)
    : studyEvents.slice(0, revealedEvents);
  return `
    <section class="view">
      ${viewHeader("Scenario Lab", "Replay deterministic untuk skenario kanonik dan simulasi vintage 2024/2025/2026.", renderScenarioButtons(selectedScenario))}
      <div class="scenario-layout">
        <div class="scenario-sidebar-tabs">
          <div class="scenario-cascade-tabs" role="tablist" aria-label="Panel Scenario Lab">
            <button class="${(state.scenarioTab || "guide") === "guide" ? "active" : ""}" data-action="scenario-tab" data-tab-group="controls" data-tab="guide" role="tab">Panduan</button>
            <button class="${state.scenarioTab === "surrender" ? "active" : ""}" data-action="scenario-tab" data-tab-group="controls" data-tab="surrender" role="tab">Surrender</button>
          </div>
          ${(state.scenarioTab || "guide") === "guide" ? `<div class="card card-pad scenario-tab-panel">
            <h2>Panduan Skenario</h2>
            ${renderScenarioBrief(selectedScenario)}
            <div class="ticket" style="margin-top:12px">
              <button data-action="step-event" class="primary">Langkah Berikutnya</button>
              <button data-action="run-scenario">Jalankan Penuh</button>
              <button data-action="reset-scenario">Reset</button>
            </div>
            <div class="status-list" style="margin-top:12px">
              <div class="status-row"><span class="muted small">Scenario</span><strong>${esc(state.scenarioId)}</strong>${badge(state.scenarioName)}</div>
              <div class="status-row"><span class="muted small">Progress</span><strong>${qty(revealedEvents)} / ${qty(totalStudyEvents)}</strong>${badge(state.events.length ? "hasil penuh" : "belajar bertahap")}</div>
              <div class="status-row"><span class="muted small">Volume</span><strong>${qty(s.volume)}</strong>${badge(`${state.trades.length} trades`)}</div>
              <div class="status-row"><span class="muted small">Gross</span><strong>${money(s.gross)}</strong>${badge(`Fee ${money(s.fee)}`)}</div>
              <div class="status-row"><span class="muted small">VWAP</span><strong>${s.vwap ? price(Math.round(s.vwap)) : "-"}</strong>${badge(`LTP ${price(s.ltp)}`)}</div>
            </div>
          </div>` : `<div class="scenario-tab-panel">${renderSurrenderCard(state, selectedScenario)}</div>`}
        </div>
        <div class="scenario-results-tabs">
          <div class="scenario-cascade-tabs" role="tablist" aria-label="Hasil Scenario Lab">
            <button class="${(state.scenarioResultTab || "trades") === "trades" ? "active" : ""}" data-action="scenario-tab" data-tab-group="results" data-tab="trades" role="tab">Trades</button>
            <button class="${state.scenarioResultTab === "positions" ? "active" : ""}" data-action="scenario-tab" data-tab-group="results" data-tab="positions" role="tab">Positions</button>
            <button class="${state.scenarioResultTab === "events" ? "active" : ""}" data-action="scenario-tab" data-tab-group="results" data-tab="events" role="tab">Event Feed</button>
          </div>
          <div class="scenario-tab-panel scenario-results-panel">
            ${(state.scenarioResultTab || "trades") === "trades" ? `<div class="card"><div class="section-title"><h2>Trades</h2>${badge(`${state.trades.length} trades`)}</div>${renderTradesTable(state.trades)}</div>` : ""}
            ${state.scenarioResultTab === "positions" ? renderPositionTable(state.positions) : ""}
            ${state.scenarioResultTab === "events" ? renderEventFeed(shownEvents, totalStudyEvents) : ""}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderSurrenderCard(state, selectedScenario) {
  const order = scenarioDefinitions[selectedScenario].order;
  const position = state.positions.find((item) => item.participant_id === "PART-D");
  const request = state.surrenderRequests.at(-1);
  const result = state.surrenders.at(-1) || request;
  const completedPosition = runScenario(selectedScenario).positions.find((item) => item.participant_id === "PART-D");
  const recommendedQuantity = Math.max(0, -completedPosition.compliance_position);
  return `
    <div class="surrender-card">
      <div class="section-title"><h3>Surrender</h3>${badge(result?.status || "READY", result?.status === "SURRENDERED" ? "sim" : "")}</div>
      <div class="field"><label>Vintage / Compliance Period</label><input value="${esc(`${order.vintage_year} / ${order.target_compliance_period_id}`)}" readonly></div>
      <div class="field"><label>Holding tersedia</label><input value="${qty(position?.holding || 0)} tCO2e" readonly></div>
      <div class="field"><label>Quantity surrender</label><input id="surrender-quantity" type="number" min="1" step="1" value="${esc(request?.quantity || recommendedQuantity)}"></div>
      <div class="strip-group surrender-actions">
        <button data-action="validate-surrender">Validasi Surrender</button>
        <button class="primary" data-action="run-surrender">Jalankan Surrender</button>
      </div>
      ${result?.registry_ref ? `<div class="muted small">Registry: ${esc(result.registry_ref)}</div>` : ""}
    </div>
  `;
}

function renderEventFeed(events, totalEvents = events.length) {
  return `
    <div class="card">
      <div class="section-title"><h2>Event Feed</h2>${badge(`${events.length}/${totalEvents} events`)}</div>
      <div class="event-feed card-pad">
        ${events.length ? events.map((event) => `
          <div class="event">
            <span class="event-code">${event.event_id}</span>
            <div><strong>${esc(event.event_type)}</strong><div class="muted small">${esc(event.label)}</div></div>
            <span class="muted small">${esc(event.correlation_id)}</span>
          </div>
        `).join("") : `<div class="empty">Belum ada event. Pilih "Langkah Berikutnya" untuk mempelajari alur satu per satu.</div>`}
      </div>
    </div>
  `;
}

function participantsView(state) {
  return `
    <section class="view">
      ${viewHeader("Participant & Market Access", "Mapping participant, installation, trader account, dan side access.")}
      <div class="card">
        <div class="table-wrap">
          <table><thead><tr><th>Participant</th><th>Access</th><th class="num">Quota</th><th class="num">Emission</th><th>Status</th></tr></thead>
          <tbody>${participants.map((p) => `<tr><td>${p.name}</td><td>${p.side}</td><td class="num">${qty(p.quota)}</td><td class="num">${qty(p.emission)}</td><td>${status("ACTIVE")}</td></tr>`).join("")}</tbody></table>
        </div>
      </div>
      <div style="margin-top:14px">
        ${renderVintageAvailabilityTable(participants)}
      </div>
    </section>
  `;
}

function productsView(state) {
  return `
    <section class="view">
      ${viewHeader("Product & Series", "Series, vintage, dan compliance period disimpan terpisah.")}
      <div class="grid cols-4">
        ${metric("Product Code", state.product.product_code)}
        ${metric("Series", state.product.series_code, "Kode simulasi")}
        ${metric("Admitted Vintages", String(quotaVintages.length), vintagesLabel(quotaVintages))}
        ${metric("Compliance Period", state.product.target_compliance_period_label, state.product.compliance_period_id)}
      </div>
      <div class="card" style="margin-top:14px">
        <div class="section-title">
          <h2>Quota Vintage & Admission</h2>
          ${badge("Series tunggal, vintage terpisah")}
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vintage</th>
                <th>Admission</th>
                <th>Fungibility Key</th>
                <th>Eligible Period</th>
                <th>Banking Status</th>
                <th>Expiry</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${quotaVintages.map((vintage) => `
                <tr>
                  <td>${esc(vintage.display_label)}</td>
                  <td>${esc(vintage.product_admission_id)}</td>
                  <td>${esc(vintage.fungibility_key)}</td>
                  <td>${esc(vintage.eligible_compliance_period_ids.join(", "))}</td>
                  <td>${badge(vintage.banking_status, vintage.banking_status === "CURRENT_YEAR" ? "blue" : "warn")}</td>
                  <td>${esc(vintage.expires_at.slice(0, 10))}</td>
                  <td>${status(vintage.status)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div style="margin-top:14px">${renderVintageTradingExamples()}</div>
    </section>
  `;
}

function renderVintageTradingExamples() {
  return `
    <div class="card">
      <div class="section-title">
        <h2>Contoh Perdagangan Vintage 2024/2025/2026 Saat Ini</h2>
        ${badge("SIMULASI", "sim")}
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Trade Date</th>
              <th>Vintage</th>
              <th>Order</th>
              <th>Buyer</th>
              <th>Seller</th>
              <th class="num">Qty</th>
              <th>Execution</th>
              <th class="num">Gross</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${vintageTradingExamples.map((item) => `
              <tr>
                <td>${esc(item.scenario_id)}</td>
                <td>${esc(item.trade_date)}</td>
                <td>${badge(`Vintage ${item.vintage_year}`, "warn")}</td>
                <td>${esc(item.order_id)} / ${esc(item.order_type)}</td>
                <td>${esc(item.buyer)}<div class="muted small">${esc(item.beneficiary_installation_id)}</div></td>
                <td>${esc(item.sellers)}<div class="muted small">${esc(item.source_installations)}</div></td>
                <td class="num">${qty(item.quantity)}</td>
                <td>${esc(item.execution)}<div class="muted small">${esc(item.note)}</div></td>
                <td class="num">${money(item.gross_value_idr)}</td>
                <td>${status(item.final_state)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function rulesetView(state) {
  const rows = Object.entries({
    price_tick_idr: state.ruleset.price_tick_idr,
    reference_price_idr: state.ruleset.reference_price_idr,
    price_band: "+/-20%",
    order_types: "LIMIT, MARKET, STOP",
    market_protection_price_idr: state.ruleset.market_protection_price_idr,
    banking_allowed: String(state.ruleset.banking_allowed),
    cross_vintage_matching: String(state.ruleset.cross_vintage_matching),
    resale_gate: state.ruleset.resale_gate,
    settlement_cycle: state.ruleset.settlement_cycle,
    registry_mode: state.ruleset.registry_mode
  });
  return `
    <section class="view">
      ${viewHeader("Ruleset & Session", "Parameter aktif ditampilkan dengan status kepastian simulasi.")}
      <div class="card">
        <div class="table-wrap"><table><thead><tr><th>Parameter</th><th>Value</th><th>Source</th></tr></thead>
        <tbody>${rows.map(([key, value]) => `<tr><td>${key}</td><td>${esc(value)}</td><td>${badge(sourceFor(key), sourceFor(key) === "ASUMSI_SIMULASI" ? "warn" : "blue")}</td></tr>`).join("")}</tbody></table></div>
      </div>
    </section>
  `;
}

function sourceFor(key) {
  if (key.includes("protection")) return "ASUMSI_SIMULASI";
  if (key.includes("banking") || key.includes("cross_vintage")) return "ASUMSI_SIMULASI";
  if (key.includes("tick") || key.includes("band")) return "IDX_BENCHMARK_2026";
  return "FIXED_PROJECT";
}

function surveillanceView(state) {
  return `
    <section class="view">
      ${viewHeader("Surveillance & Halt", "Self-match, suspension, dan emergency event evidence.")}
      <div class="grid cols-3">
        ${metric("Alerts", qty(state.alerts.length), "Baseline clear")}
        ${metric("Session", state.session.state, "New order allowed")}
        ${metric("Emergency", "None", "No halt reason")}
      </div>
    </section>
  `;
}

function auditView(state) {
  return `
    <section class="view">
      ${viewHeader("Audit Trail", "State-changing command dan correlation ID.")}
      ${renderEventFeed(state.events)}
    </section>
  `;
}
