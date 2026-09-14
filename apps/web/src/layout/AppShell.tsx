import { ReactNode, useEffect, useState } from 'react';
import { navigationLabelFromHash } from '../app/navigation';
import { money, number, priceOrDash } from '../shared/format';

interface AppShellProps {
  children: ReactNode;
  participantId: string;
  installationId?: string;
  positionPeriod: number;
  targetCompliancePeriod: number;
  vintageYear?: number;
  sessionStatus?: 'OPEN' | 'HALTED' | 'CLOSED';
  referencePrice: number;
  lastTradedPrice: number | null;
  bestAsk: number | null;
  volume: number;
  vwap: number | null;
  rulesetVersion?: number;
  authControl: ReactNode;
}

interface NavItem {
  label: string;
  icon: string;
  target?: string;
}

const navigation: Array<{ label: string; items: NavItem[] }> = [
  { label: 'Overview', items: [{ label: 'Dashboard', icon: 'D', target: 'dashboard' }] },
  {
    label: 'Regular Market',
    items: [
      { label: 'Pasar Reguler', icon: 'M', target: 'regular-market' },
      { label: 'Orders', icon: 'O', target: 'orders' },
      { label: 'Trades', icon: 'T', target: 'trades' },
      { label: 'Scenario Lab', icon: 'S', target: 'scenario-lab' },
    ],
  },
  {
    label: 'Quota & Post-Trade',
    items: [
      { label: 'Positions', icon: 'P', target: 'positions' },
      { label: 'Settlement', icon: 'C', target: 'settlement' },
      { label: 'SRUK & Reconciliation', icon: 'R', target: 'settlement' },
    ],
  },
  {
    label: 'Market Operations',
    items: [
      { label: 'Participants', icon: 'A', target: 'participants' },
      { label: 'Product & Series', icon: 'B', target: 'product-series' },
      { label: 'Ruleset', icon: 'V', target: 'ruleset' },
      { label: 'Surveillance', icon: '!', target: 'surveillance' },
      { label: 'Audit Trail', icon: 'L', target: 'audit' },
    ],
  },
];

export function AppShell({
  children,
  participantId,
  installationId,
  positionPeriod,
  targetCompliancePeriod,
  vintageYear,
  sessionStatus,
  referencePrice,
  lastTradedPrice,
  bestAsk,
  volume,
  vwap,
  rulesetVersion,
  authControl,
}: AppShellProps) {
  const [activeItem, setActiveItem] = useState(() => navigationLabelFromHash(window.location.hash));

  useEffect(() => {
    const updateActiveItem = () => setActiveItem(navigationLabelFromHash(window.location.hash));
    window.addEventListener('hashchange', updateActiveItem);
    return () => window.removeEventListener('hashchange', updateActiveItem);
  }, []);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">ETS</span>
          <div>
            <strong className="brand-title">Emission Trading System</strong>
            <span className="brand-subtitle">Regular Market · PTBAE-IND · Position {positionPeriod}</span>
          </div>
        </div>
        <div className="top-actions" aria-label="Konteks aplikasi">
          <span className="shell-chip shell-chip--sim">SIMULASI</span>
          <span className="shell-chip">Regular Market</span>
          <span className="shell-chip shell-chip--blue">{rulesetVersion ? `V${rulesetVersion}` : 'Ruleset —'}</span>
          <span className="shell-chip shell-chip--warning">SRUK Simulation</span>
        </div>
      </header>

      <aside className="sidebar" aria-label="Navigasi utama">
        {navigation.map((section) => (
          <nav className="nav-section" aria-label={section.label} key={section.label}>
            <div className="nav-label">{section.label}</div>
            {section.items.map((item) => item.target ? (
              <a
                className={`nav-link${activeItem === item.label ? ' active' : ''}`}
                href={`#${item.target}`}
                key={`${item.label}-${item.target}`}
                aria-current={activeItem === item.label ? 'page' : undefined}
                onClick={() => setActiveItem(item.label)}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
              </a>
            ) : (
              <span className="nav-link nav-link--pending" aria-disabled="true" key={item.label}>
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                <span>{item.label}</span>
                <small>next</small>
              </span>
            ))}
          </nav>
        ))}
      </aside>

      <div className="workspace">
        <div className="context-strip">
          <div className="strip-group">
            <span className="shell-chip">Demo Operator</span>
            <span className="shell-chip">Participant: {participantId || '—'}</span>
            <span className="shell-chip">Installation: {installationId ?? '—'}</span>
            <span className="shell-chip">Position: {positionPeriod}</span>
          </div>
          <div className="strip-group">
            <span className="shell-chip shell-chip--blue">PTBAE-IND</span>
            <span className="shell-chip shell-chip--blue">{vintageYear ? `Vintage ${vintageYear}` : 'Vintage —'}</span>
            <span className="shell-chip">Target CP-{targetCompliancePeriod}</span>
            <span className="shell-chip">tCO₂e</span>
          </div>
        </div>

        <div className="market-strip">
          <div className="strip-group">
            <span className={`shell-chip session-${sessionStatus?.toLowerCase() ?? 'unknown'}`}>
              Session {sessionStatus ?? '—'}
            </span>
          </div>
          <div className="strip-group market-indicators">
            <span className="shell-chip">Ref {money.format(referencePrice)}</span>
            <span className="shell-chip shell-chip--blue">LTP {priceOrDash(lastTradedPrice)}</span>
            <span className="shell-chip">Best Ask {priceOrDash(bestAsk)}</span>
            <span className="shell-chip">Volume {number.format(volume)}</span>
            <span className="shell-chip">VWAP {priceOrDash(vwap)}</span>
          </div>
        </div>

        <div className="credential-strip">{authControl}</div>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
