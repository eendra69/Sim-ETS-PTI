import { scenarioDefinitions } from "./data.js";
import { createInitialState, processSurrender, runScenario, validateSurrender } from "./engine.js";
import { renderApp } from "./render.js";

let selectedScenario = "M-30";
let state = createScenarioStudyState(selectedScenario);
let surrenderQuantity = recommendedSurrenderQuantity(selectedScenario);
let toastTimer = null;

function createScenarioStudyState(scenarioId, revealedEvents = 0) {
  const base = createInitialState(scenarioId);
  const full = runScenario(scenarioId);
  base.studyEvents = full.events;
  base.studyTotalEvents = full.events.length;
  base.studySummary = full.summary;
  base.revealedEvents = Math.min(revealedEvents, full.events.length);
  return base;
}

function currentRoute() {
  const route = window.location.hash.replace(/^#\/?/, "");
  return route || "dashboard";
}

function render() {
  document.getElementById("app").innerHTML = renderApp(state, currentRoute(), selectedScenario);
}

function showToast(message) {
  state.toast = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = "";
    render();
  }, 2600);
}

window.addEventListener("hashchange", render);

document.addEventListener("click", (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    window.location.hash = `#/${routeButton.dataset.route}`;
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;

  if (action === "run-scenario") {
    state = runScenario(selectedScenario);
    showToast(`${selectedScenario} selesai dijalankan.`);
  }

  if (action === "reset-scenario") {
    state = createScenarioStudyState(selectedScenario);
    showToast(`${selectedScenario} di-reset. Belum ada transaksi dijalankan.`);
  }

  if (action === "validate") {
    showToast(`Validation snapshot dibuat untuk ${scenarioDefinitions[selectedScenario].order.order_id}.`);
  }

  if (action === "step-event") {
    const full = runScenario(selectedScenario);
    const next = Math.min((state.revealedEvents || 0) + 1, full.events.length);
    state = createScenarioStudyState(selectedScenario, next);
    showToast(`Langkah ${next}/${full.events.length}. State transaksi belum dieksekusi penuh.`);
  }

  if (action === "validate-surrender") {
    const request = surrenderRequest();
    const validation = validateSurrender(state, request);
    showToast(`Validasi surrender: ${validation.outcome}.`);
  }

  if (action === "run-surrender") {
    if (!state.trades.length) state = runScenario(selectedScenario);
    const result = processSurrender(state, surrenderRequest());
    state = result.state;
    showToast(`Surrender ${result.surrender.status}.`);
  }

  if (action === "scenario-tab") {
    const tabButton = event.target.closest("[data-tab]");
    const tabStateKey = tabButton.dataset.tabGroup === "results"
      ? "scenarioResultTab"
      : tabButton.dataset.tabGroup === "market"
        ? "marketTab"
        : "scenarioTab";
    state[tabStateKey] = tabButton.dataset.tab;
    render();
  }
});

function surrenderRequest() {
  const order = scenarioDefinitions[selectedScenario].order;
  return {
    surrender_id: `SUR-${selectedScenario}-01`,
    participant_id: "PART-D",
    installation_id: order.beneficiary_installation_id,
    vintage_year: order.vintage_year,
    compliance_period_id: order.target_compliance_period_id,
    quantity: surrenderQuantity
  };
}

function recommendedSurrenderQuantity(scenarioId) {
  const completed = runScenario(scenarioId);
  const position = completed.positions.find((item) => item.participant_id === "PART-D");
  return Math.max(0, -position.compliance_position);
}

document.addEventListener("change", (event) => {
  if (event.target.id === "scenario-select") {
    selectedScenario = event.target.value;
    surrenderQuantity = recommendedSurrenderQuantity(selectedScenario);
    state = createScenarioStudyState(selectedScenario);
    render();
  }

  if (event.target.id === "surrender-quantity") {
    surrenderQuantity = Number(event.target.value);
  }
});

if (!window.location.hash) {
  window.location.hash = "#/simulation";
} else {
  render();
}
