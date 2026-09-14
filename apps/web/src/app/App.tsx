import { useEffect, useState } from 'react';
import { MarketDashboardPage } from '../pages/MarketDashboardPage';
import { workspaceViewFromHash } from './navigation';

export function App() {
  const [view, setView] = useState(() => workspaceViewFromHash(window.location.hash));

  useEffect(() => {
    const updateView = () => setView(workspaceViewFromHash(window.location.hash));
    window.addEventListener('hashchange', updateView);
    return () => window.removeEventListener('hashchange', updateView);
  }, []);

  return <MarketDashboardPage view={view} />;
}
