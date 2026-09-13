export interface ScenarioOrderSeed {
  participantId: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
}

export interface ScenarioSeed {
  initialPositions: Record<string, number>;
  orders: ScenarioOrderSeed[];
  autoSettle: boolean;
}

export interface ScenarioDefinition {
  scenarioId: string;
  name: string;
  seriesCode: string;
  compliancePeriod: number;
  rulesetId: string;
  seed: ScenarioSeed;
  createdBy: string;
  createdAt: string;
}

export interface ScenarioEvent {
  eventId: string;
  eventSequence: number;
  eventType: 'ORDER_ACCEPTED' | 'TRADE_EXECUTED' | 'SETTLEMENT_FINALIZED' | 'POSITION_UPDATED';
  payload: Record<string, unknown>;
}

export interface ScenarioResult {
  scenarioId: string;
  rulesetId: string;
  events: ScenarioEvent[];
  trades: Array<{ tradeId: string; buyerParticipantId: string; sellerParticipantId: string; quantity: number; price: number }>;
  finalPositions: Record<string, number>;
}

export interface ScenarioRun {
  runId: string;
  scenarioId: string;
  runNumber: number;
  result: ScenarioResult;
  resultHash: string;
  replayOfRunId?: string;
  isDeterministicMatch?: boolean;
  createdAt: string;
}
