export const ruleset = {
  ruleset_id: "RULE-PTBAE-IND-REG-2026-01",
  version: "1.2.0",
  status: "ACTIVE",
  series_code: "PTBAE-IND",
  vintage_required: true,
  seed_vintage_year: 2026,
  seed_compliance_period_id: "CP-2027",
  display_label: "PTBAE-IND - Periode Kepatuhan 2027",
  banking_allowed: false,
  borrowing_allowed: false,
  cross_vintage_matching: false,
  expiry_enforcement: true,
  company_position_can_reserve: false,
  timezone: "Asia/Jakarta",
  session: "07:00:00-19:00:00",
  price_tick_idr: 200,
  minimum_price_idr: 200,
  reference_price_idr: 75000,
  lower_band_idr: 60000,
  upper_band_idr: 90000,
  fee_rate_bps: 10,
  market_protection_price_idr: 80000,
  settlement_cycle: "T+0",
  registry_mode: "SRUK_SIMULATION",
  resale_gate: "SETTLED_ACKNOWLEDGED_RECONCILED",
  certainty: {
    order_types: "FIXED_PROJECT",
    vintage: "FIXED_PROJECT",
    banking: "ASUMSI_SIMULASI",
    tick: "IDX_BENCHMARK_2026",
    protection: "ASUMSI_SIMULASI",
    registry: "ASUMSI_SIMULASI"
  }
};

export const product = {
  product_code: "KUOTA-EMISI-GRK-INDUSTRI",
  product_name: "Kuota Emisi GRK Industri",
  series_code: "PTBAE-IND",
  vintage_year: 2026,
  vintage_id: "VINT-PTBAE-IND-2026",
  compliance_period_id: "CP-2027",
  display_label: "PTBAE-IND - Periode Kepatuhan 2027",
  target_compliance_period_label: "2027",
  product_admission_id: "ADM-PTBAE-IND-V2026-REG",
  fungibility_key: "PTBAE-IND:V2026:REG",
  effective_from: "2026-01-01T00:00:00+07:00",
  expires_at: "2027-12-31T23:59:59+07:00",
  unit: "tCO2e",
  currency: "IDR",
  market_segment: "REGULAR",
  status: "ACTIVE"
};

export const quotaVintages = [
  {
    vintage_id: "VINT-PTBAE-IND-2024",
    series_code: "PTBAE-IND",
    vintage_year: 2024,
    display_label: "PTBAE-IND - Vintage 2024",
    product_admission_id: "ADM-PTBAE-IND-V2024-REG",
    fungibility_key: "PTBAE-IND:V2024:REG",
    effective_from: "2024-01-01T00:00:00+07:00",
    expires_at: "2027-12-31T23:59:59+07:00",
    eligible_compliance_period_ids: ["CP-2026", "CP-2027"],
    banking_status: "BANKED_AVAILABLE",
    status: "ACTIVE",
    policy_source: "CARRYOVER_SIMULATION"
  },
  {
    vintage_id: "VINT-PTBAE-IND-2025",
    series_code: "PTBAE-IND",
    vintage_year: 2025,
    display_label: "PTBAE-IND - Vintage 2025",
    product_admission_id: "ADM-PTBAE-IND-V2025-REG",
    fungibility_key: "PTBAE-IND:V2025:REG",
    effective_from: "2025-01-01T00:00:00+07:00",
    expires_at: "2027-12-31T23:59:59+07:00",
    eligible_compliance_period_ids: ["CP-2027"],
    banking_status: "BANKED_AVAILABLE",
    status: "ACTIVE",
    policy_source: "CARRYOVER_SIMULATION"
  },
  {
    vintage_id: "VINT-PTBAE-IND-2026",
    series_code: "PTBAE-IND",
    vintage_year: 2026,
    display_label: "PTBAE-IND - Vintage 2026",
    product_admission_id: "ADM-PTBAE-IND-V2026-REG",
    fungibility_key: "PTBAE-IND:V2026:REG",
    effective_from: "2026-01-01T00:00:00+07:00",
    expires_at: "2027-12-31T23:59:59+07:00",
    eligible_compliance_period_ids: ["CP-2026", "CP-2027"],
    banking_status: "CURRENT_YEAR",
    status: "ACTIVE",
    policy_source: "CURRENT_2026_SIMULATION"
  }
];

export const vintageTradingExamples = [
  {
    scenario_id: "M-32",
    trade_date: "2026-09-13",
    series_code: "PTBAE-IND",
    vintage_year: 2024,
    trading_status: "ACTIVE_SIMULATION",
    order_type: "LIMIT",
    buyer: "Industri D",
    beneficiary_installation_id: "INST-D-01",
    target_compliance_period_id: "CP-2027",
    sellers: "Industri A, Industri B",
    source_installations: "INST-A-01, INST-B-01",
    order_id: "B-V24-01",
    quantity: 25000,
    execution: "15.000 @ Rp68.000 + 10.000 @ Rp69.000",
    gross_value_idr: 1710000000,
    vwap_idr: 68400,
    ltp_idr: 69000,
    final_state: "FILLED",
    note: "Kuota vintage 2024 berstatus BANKED_AVAILABLE dan masih eligible untuk diperdagangkan sekarang."
  },
  {
    scenario_id: "M-30",
    trade_date: "2027-09-15",
    series_code: "PTBAE-IND",
    vintage_year: 2026,
    trading_status: "ACTIVE_SIMULATION",
    order_type: "LIMIT",
    buyer: "Industri D",
    beneficiary_installation_id: "INST-D-01",
    target_compliance_period_id: "CP-2027",
    sellers: "Industri A, Industri B",
    source_installations: "INST-A-01, INST-B-01",
    order_id: "B-V26-01",
    quantity: 40000,
    execution: "20.000 @ Rp73.000 + 20.000 @ Rp74.000",
    gross_value_idr: 2940000000,
    vwap_idr: 73500,
    ltp_idr: 74000,
    final_state: "FILLED",
    note: "Kuota vintage 2026 berstatus CURRENT_YEAR dan diperdagangkan pada simulasi saat ini."
  },
  {
    scenario_id: "M-31",
    trade_date: "2027-09-15",
    series_code: "PTBAE-IND",
    vintage_year: 2025,
    trading_status: "ACTIVE_SIMULATION",
    order_type: "MARKET",
    buyer: "Industri D",
    beneficiary_installation_id: "INST-D-01",
    target_compliance_period_id: "CP-2027",
    sellers: "Industri A, Industri B",
    source_installations: "INST-A-01, INST-B-01",
    order_id: "B-V25-01",
    quantity: 30000,
    executed_quantity: 25000,
    cancelled_remainder: 5000,
    execution: "10.000 @ Rp70.000 + 15.000 @ Rp71.000; sisa 5.000 IOC cancelled",
    gross_value_idr: 1765000000,
    vwap_idr: 70600,
    ltp_idr: 71000,
    final_state: "CANCELLED_REMAINDER",
    note: "Kuota vintage 2025 berstatus BANKED_AVAILABLE; ask berikutnya Rp73.000 melewati protection ceiling Rp72.000."
  }
];

export const currentUser = {
  user_id: "USR-DEMO-TRADER",
  display_name: "Demo Trader",
  participant_id: "PART-D",
  trader_account_id: "TA-D-001",
  installation_scope: ["INST-D-01"],
  allowed_vintages: [2024, 2025, 2026],
  compliance_periods: ["CP-2026", "CP-2027"],
  permissions: [
    "market.dashboard.view",
    "market.orderbook.view",
    "market.order.submit",
    "market.trade.view.participant",
    "market.position.view.participant",
    "market.settlement.manage",
    "market.registry.view",
    "market.ruleset.view",
    "market.audit.view",
    "market.simulation.run"
  ],
  status: "ACTIVE"
};

export const participants = [
  {
    id: "PART-A",
    name: "Industri A",
    installation_id: "INST-A-01",
    side: "SELL",
    quota: 1200000,
    emission: 1170000,
    funds: 750000000,
    holdings: [
      { vintage_year: 2024, available: 35000 },
      { vintage_year: 2025, available: 25000 },
      { vintage_year: 2026, available: 55000 }
    ]
  },
  {
    id: "PART-B",
    name: "Industri B",
    installation_id: "INST-B-01",
    side: "SELL",
    quota: 2100000,
    emission: 2050000,
    funds: 900000000,
    holdings: [
      { vintage_year: 2024, available: 30000 },
      { vintage_year: 2025, available: 40000 },
      { vintage_year: 2026, available: 70000 }
    ]
  },
  {
    id: "PART-C",
    name: "Industri C",
    installation_id: "INST-C-01",
    side: "SELL",
    quota: 900000,
    emission: 860000,
    funds: 600000000,
    holdings: [
      { vintage_year: 2024, available: 20000 },
      { vintage_year: 2025, available: 25000 },
      { vintage_year: 2026, available: 25000 }
    ]
  },
  {
    id: "PART-D",
    name: "Industri D",
    installation_id: "INST-D-01",
    side: "BUY",
    quota: 1500000,
    emission: 1560000,
    funds: 5000000000,
    holdings: [
      { vintage_year: 2024, available: 5000 },
      { vintage_year: 2025, available: 8000 },
      { vintage_year: 2026, available: 12000 }
    ]
  },
  {
    id: "PART-E",
    name: "Industri E",
    installation_id: "INST-E-01",
    side: "SELL",
    quota: 1600000,
    emission: 1520000,
    funds: 800000000,
    holdings: [
      { vintage_year: 2024, available: 18000 },
      { vintage_year: 2025, available: 22000 },
      { vintage_year: 2026, available: 45000 }
    ]
  },
  {
    id: "PART-F",
    name: "Industri F",
    installation_id: "INST-F-01",
    side: "BUY",
    quota: 1100000,
    emission: 1170000,
    funds: 4200000000,
    holdings: [
      { vintage_year: 2024, available: 2000 },
      { vintage_year: 2025, available: 4000 },
      { vintage_year: 2026, available: 6000 }
    ]
  },
  {
    id: "PART-G",
    name: "Industri G",
    installation_id: "INST-G-01",
    side: "BUY_SELL",
    quota: 1800000,
    emission: 1790000,
    funds: 2500000000,
    holdings: [
      { vintage_year: 2024, available: 12000 },
      { vintage_year: 2025, available: 18000 },
      { vintage_year: 2026, available: 30000 }
    ]
  },
  {
    id: "PART-H",
    name: "Industri H",
    installation_id: "INST-H-01",
    side: "SELL",
    quota: 1300000,
    emission: 1240000,
    funds: 1100000000,
    holdings: [
      { vintage_year: 2024, available: 24000 },
      { vintage_year: 2025, available: 36000 },
      { vintage_year: 2026, available: 52000 }
    ]
  },
  {
    id: "PART-I",
    name: "Industri I",
    installation_id: "INST-I-01",
    side: "BUY",
    quota: 980000,
    emission: 1080000,
    funds: 3600000000,
    holdings: [
      { vintage_year: 2024, available: 4000 },
      { vintage_year: 2025, available: 7000 },
      { vintage_year: 2026, available: 9000 }
    ]
  },
  {
    id: "PART-J",
    name: "Industri J",
    installation_id: "INST-J-01",
    side: "BUY_SELL",
    quota: 1750000,
    emission: 1760000,
    funds: 2800000000,
    holdings: [
      { vintage_year: 2024, available: 10000 },
      { vintage_year: 2025, available: 16000 },
      { vintage_year: 2026, available: 28000 }
    ]
  }
];

export const scenarioDefinitions = {
  "M-06": {
    id: "M-06",
    name: "LIMIT multi-seller",
    order: {
      order_id: "B-L01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "LIMIT",
      quantity: 60000,
      limit_price_idr: 76000,
      time_in_force: "DAY"
    },
    sellBook: [
      { order_id: "S-L01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 30000, price_idr: 75000, sequence: 1 },
      { order_id: "S-L02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 50000, price_idr: 76000, sequence: 2 },
      { order_id: "S-L03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 40000, price_idr: 78000, sequence: 3 },
      { order_id: "S-L04", participant_id: "PART-E", source_installation_id: "INST-E-01", quantity: 25000, price_idr: 82000, sequence: 4 },
      { order_id: "S-L05", participant_id: "PART-G", source_installation_id: "INST-G-01", quantity: 18000, price_idr: 84000, sequence: 5 },
      { order_id: "S-L06", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 22000, price_idr: 86000, sequence: 6 },
      { order_id: "S-L07", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 16000, price_idr: 88000, sequence: 7 }
    ],
    triggerEvents: []
  },
  "M-17": {
    id: "M-17",
    name: "MARKET immediate sweep",
    order: {
      order_id: "B-M01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "MARKET",
      quantity: 60000,
      protection_price_idr: 80000,
      time_in_force: "IOC"
    },
    sellBook: [
      { order_id: "S-M01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 30000, price_idr: 75000, sequence: 1 },
      { order_id: "S-M02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 20000, price_idr: 76000, sequence: 2 },
      { order_id: "S-M03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 40000, price_idr: 78000, sequence: 3 },
      { order_id: "S-M04", participant_id: "PART-E", source_installation_id: "INST-E-01", quantity: 22000, price_idr: 79000, sequence: 4 },
      { order_id: "S-M05", participant_id: "PART-G", source_installation_id: "INST-G-01", quantity: 16000, price_idr: 80500, sequence: 5 },
      { order_id: "S-M06", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 22000, price_idr: 82000, sequence: 6 },
      { order_id: "S-M07", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 16000, price_idr: 84000, sequence: 7 }
    ],
    triggerEvents: []
  },
  "M-18": {
    id: "M-18",
    name: "STOP trigger to MARKET",
    order: {
      order_id: "B-S01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "STOP",
      quantity: 60000,
      stop_price_idr: 76000,
      protection_price_idr: 80000,
      trigger_basis: "LTP",
      trigger_direction: "GREATER_THAN_OR_EQUAL",
      activation_order_type: "MARKET",
      time_in_force: "DAY",
      activation_time_in_force: "IOC"
    },
    sellBook: [
      { order_id: "S-S01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 30000, price_idr: 76000, sequence: 1 },
      { order_id: "S-S02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 50000, price_idr: 76200, sequence: 2 },
      { order_id: "S-S03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 40000, price_idr: 78000, sequence: 3 },
      { order_id: "S-S04", participant_id: "PART-E", source_installation_id: "INST-E-01", quantity: 24000, price_idr: 79000, sequence: 4 },
      { order_id: "S-S05", participant_id: "PART-G", source_installation_id: "INST-G-01", quantity: 14000, price_idr: 80600, sequence: 5 },
      { order_id: "S-S06", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 22000, price_idr: 82000, sequence: 6 },
      { order_id: "S-S07", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 16000, price_idr: 84000, sequence: 7 }
    ],
    triggerEvents: [
      { event_id: "MD-EVT-75000", ltp: 75000, decision: "NOT_MET" },
      { event_id: "MD-EVT-75800", ltp: 75800, decision: "NOT_MET" },
      { event_id: "MD-EVT-76000", ltp: 76000, decision: "MET" },
      { event_id: "MD-EVT-76000", ltp: 76000, decision: "DUPLICATE_IGNORED" }
    ]
  },
  "M-30": {
    id: "M-30",
    name: "Vintage 2026 current-year LIMIT",
    vintage_year: 2026,
    scenario_profile: "CURRENT_2026_SIMULATION",
    notes: "Simulasi kuota tahun 2026 sebagai current-year vintage yang diperdagangkan sekarang. Cross-vintage matching tetap disabled.",
    order: {
      order_id: "B-V26-01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "LIMIT",
      quantity: 40000,
      limit_price_idr: 74000,
      time_in_force: "DAY"
    },
    sellBook: [
      { order_id: "S-V26-01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 20000, price_idr: 73000, sequence: 1 },
      { order_id: "S-V26-02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 30000, price_idr: 74000, sequence: 2 },
      { order_id: "S-V26-03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 15000, price_idr: 76000, sequence: 3 },
      { order_id: "S-V26-04", participant_id: "PART-E", source_installation_id: "INST-E-01", quantity: 25000, price_idr: 75000, sequence: 4 },
      { order_id: "S-V26-05", participant_id: "PART-G", source_installation_id: "INST-G-01", quantity: 18000, price_idr: 77000, sequence: 5 },
      { order_id: "S-V26-06", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 22000, price_idr: 82000, sequence: 6 },
      { order_id: "S-V26-07", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 16000, price_idr: 84000, sequence: 7 }
    ],
    triggerEvents: []
  },
  "M-31": {
    id: "M-31",
    name: "Vintage 2025 carry-over MARKET",
    vintage_year: 2025,
    scenario_profile: "CARRYOVER_SIMULATION",
    notes: "Simulasi kuota tahun 2025 yang masih eligible/banked untuk memenuhi kewajiban CP-2026. Protection ceiling tetap membatasi MARKET IOC.",
    order: {
      order_id: "B-V25-01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2026",
      vintage_year: 2025,
      order_type: "MARKET",
      quantity: 30000,
      protection_price_idr: 72000,
      time_in_force: "IOC"
    },
    sellBook: [
      { order_id: "S-V25-01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 10000, price_idr: 70000, sequence: 1 },
      { order_id: "S-V25-02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 15000, price_idr: 71000, sequence: 2 },
      { order_id: "S-V25-03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 20000, price_idr: 73000, sequence: 3 },
      { order_id: "S-V25-04", participant_id: "PART-E", source_installation_id: "INST-E-01", quantity: 18000, price_idr: 72500, sequence: 4 },
      { order_id: "S-V25-05", participant_id: "PART-G", source_installation_id: "INST-G-01", quantity: 12000, price_idr: 73500, sequence: 5 },
      { order_id: "S-V25-06", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 22000, price_idr: 76000, sequence: 6 },
      { order_id: "S-V25-07", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 16000, price_idr: 78000, sequence: 7 }
    ],
    triggerEvents: []
  },
  "M-32": {
    id: "M-32",
    name: "Vintage 2024 banked LIMIT",
    vintage_year: 2024,
    scenario_profile: "CARRYOVER_SIMULATION",
    notes: "Simulasi kuota tahun 2024 yang masih eligible/banked untuk memenuhi kewajiban CP-2026. Cross-vintage matching tetap disabled.",
    order: {
      order_id: "B-V24-01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2026",
      vintage_year: 2024,
      order_type: "LIMIT",
      quantity: 25000,
      limit_price_idr: 69000,
      time_in_force: "DAY"
    },
    sellBook: [
      { order_id: "S-V24-01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 15000, price_idr: 68000, sequence: 1 },
      { order_id: "S-V24-02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 10000, price_idr: 69000, sequence: 2 },
      { order_id: "S-V24-03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 20000, price_idr: 71000, sequence: 3 },
      { order_id: "S-V24-04", participant_id: "PART-E", source_installation_id: "INST-E-01", quantity: 12000, price_idr: 70500, sequence: 4 },
      { order_id: "S-V24-05", participant_id: "PART-G", source_installation_id: "INST-G-01", quantity: 8000, price_idr: 71500, sequence: 5 },
      { order_id: "S-V24-06", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 22000, price_idr: 74000, sequence: 6 },
      { order_id: "S-V24-07", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 16000, price_idr: 76000, sequence: 7 }
    ],
    triggerEvents: []
  },
  "S-01": {
    id: "S-01",
    name: "Sederhana - LIMIT match",
    vintage_year: 2026,
    notes: "Satu order BUY LIMIT bertemu satu penawaran SELL.",
    order: {
      order_id: "B-S01",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "LIMIT",
      quantity: 10000,
      limit_price_idr: 74000,
      time_in_force: "DAY"
    },
    sellBook: [
      { order_id: "S-S01", participant_id: "PART-A", source_installation_id: "INST-A-01", quantity: 10000, price_idr: 73000, sequence: 1 },
      { order_id: "S-S01-H", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 10000, price_idr: 86000, sequence: 2 },
      { order_id: "S-S01-J", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 10000, price_idr: 88000, sequence: 3 }
    ],
    triggerEvents: []
  },
  "S-02": {
    id: "S-02",
    name: "Sederhana - MARKET match",
    vintage_year: 2026,
    notes: "Satu order BUY MARKET mengambil satu penawaran yang tersedia.",
    order: {
      order_id: "B-S02",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "MARKET",
      quantity: 10000,
      protection_price_idr: 76000,
      time_in_force: "IOC"
    },
    sellBook: [
      { order_id: "S-S02", participant_id: "PART-B", source_installation_id: "INST-B-01", quantity: 10000, price_idr: 73500, sequence: 1 },
      { order_id: "S-S02-J", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 10000, price_idr: 86000, sequence: 2 },
      { order_id: "S-S02-H", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 10000, price_idr: 88000, sequence: 3 }
    ],
    triggerEvents: []
  },
  "S-03": {
    id: "S-03",
    name: "Sederhana - LIMIT tidak match",
    vintage_year: 2026,
    notes: "Harga BUY berada di bawah harga SELL sehingga order belum match.",
    order: {
      order_id: "B-S03",
      side: "BUY",
      beneficiary_installation_id: "INST-D-01",
      target_compliance_period_id: "CP-2027",
      vintage_year: 2026,
      order_type: "LIMIT",
      quantity: 10000,
      limit_price_idr: 70000,
      time_in_force: "DAY"
    },
    sellBook: [
      { order_id: "S-S03", participant_id: "PART-C", source_installation_id: "INST-C-01", quantity: 10000, price_idr: 73500, sequence: 1 },
      { order_id: "S-S03-H", participant_id: "PART-H", source_installation_id: "INST-H-01", quantity: 10000, price_idr: 86000, sequence: 2 },
      { order_id: "S-S03-J", participant_id: "PART-J", source_installation_id: "INST-J-01", quantity: 10000, price_idr: 88000, sequence: 3 }
    ],
    triggerEvents: []
  }
};

export const navigation = [
  {
    label: "Ringkasan",
    items: [
      { route: "dashboard", title: "Dasbor", icon: "D" },
      { route: "simulation", title: "Lab Skenario", icon: "S" }
    ]
  },
  {
    label: "Fitur Pengguna",
    items: [
      { route: "market", title: "Pasar Reguler", icon: "M" },
      { route: "trades", title: "Transaksi", icon: "T" },
      { route: "portfolio", title: "Portofolio", icon: "P" }
    ]
  },
  {
    label: "Buku Order",
    module: "order-book",
    items: [
      { route: "visible-order-book", title: "Buku Order Terbuka", icon: "V" },
      { route: "orders", title: "Daftar Order", icon: "O" }
    ]
  },
  {
    label: "Kuota dan Pasca Transaksi",
    module: "quota-post-trade",
    items: [
      { route: "quota-post-trade", title: "Posisi & Penyelesaian", icon: "P" },
      { route: "registry", title: "SRUK & Rekonsiliasi", icon: "R" }
    ]
  },
  {
    label: "Operasi Pasar / Administrator",
    items: [
      { route: "participants", title: "Peserta", icon: "A" },
      { route: "products", title: "Produk & Seri", icon: "B" },
      { route: "ruleset", title: "Aturan", icon: "V" }
    ]
  },
  {
    label: "Kepatuhan / Kontrol",
    items: [
      { route: "surveillance", title: "Pengawasan", icon: "!" },
      { route: "audit", title: "Jejak Audit", icon: "L" }
    ]
  }
];
