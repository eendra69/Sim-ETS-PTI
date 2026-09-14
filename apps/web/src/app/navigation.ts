export type WorkspaceView = 'market' | 'participants' | 'product-series';

export function workspaceViewFromHash(hash: string): WorkspaceView {
  if (hash === '#participants') return 'participants';
  if (hash === '#product-series') return 'product-series';
  return 'market';
}

const navigationLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  'regular-market': 'Pasar Reguler',
  orders: 'Orders',
  trades: 'Trades',
  'scenario-lab': 'Scenario Lab',
  positions: 'Positions',
  settlement: 'Settlement',
  participants: 'Participants',
  'product-series': 'Product & Series',
  ruleset: 'Ruleset',
  surveillance: 'Surveillance',
  audit: 'Audit Trail',
};

export function navigationLabelFromHash(hash: string): string {
  return navigationLabels[hash.replace(/^#/, '')] ?? 'Pasar Reguler';
}
