import { useEffect, useRef, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { api, loadConfig, useAlerts, useSummary } from './lib/api';
import { inTime, money } from './lib/format';
import { Icon, ToastProvider } from './components/ui';
import { CommandCenter } from './pages/CommandCenter';
import { Opportunities } from './pages/Opportunities';
import { OpportunityDetailPage } from './pages/OpportunityDetail';
import { Portfolio } from './pages/Portfolio';
import { Research } from './pages/Research';
import { Settings, ConnectionForm } from './pages/Settings';

function Sidebar() {
  const s = useSummary().data;
  const mac = window.ff?.platform === 'darwin';
  const spendPct = s && s.dailyBudgetUsd > 0 ? Math.min(100, (s.spendTodayUsd / s.dailyBudgetUsd) * 100) : 0;
  return (
    <nav className={`sidebar ${mac ? 'mac' : ''}`} aria-label="Primary">
      <div className="brand">
        <Icon.logo />
        <div>
          <b>Finance Finder</b>
          <small>Signal command center</small>
        </div>
      </div>
      <NavLink to="/" end className="nav">
        <Icon.grid />
        Command Center
      </NavLink>
      <NavLink to="/opportunities" className="nav">
        <Icon.target />
        Opportunities
        <span className="count hot">{s?.activeSignals ?? ''}</span>
      </NavLink>
      <NavLink to="/portfolio" className="nav">
        <Icon.briefcase />
        Portfolio
        <span className="count">{s?.openPositions ?? ''}</span>
      </NavLink>
      <NavLink to="/research" className="nav">
        <Icon.pulse />
        Research queue
        <span className="count">{s ? s.jobsRunning + s.jobsQueued : ''}</span>
      </NavLink>
      <NavLink to="/settings" className="nav">
        <Icon.sliders />
        Sources &amp; models
      </NavLink>
      <div className="agent">
        <div className="row-flex" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
          <span className={`dot ${s?.autonomous ? 'live' : 'off'}`} />
          {s?.autonomous ? 'Autonomous mode on' : 'Autonomous mode off'}
        </div>
        <div style={{ fontSize: 12 }} className="muted">
          Next sweep <span className="mono" style={{ color: 'var(--text)' }}>{s?.autonomous ? inTime(s.nextSweepAt) : 'paused'}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="row-flex muted" style={{ fontSize: 12, justifyContent: 'space-between' }}>
            <span>AI spend today</span>
            <span className="mono" style={{ color: 'var(--text)' }}>
              {money(s?.spendTodayUsd ?? 0)} / {money(s?.dailyBudgetUsd ?? 0, 0)}
            </span>
          </div>
          <div className="bar">
            <span style={{ width: `${spendPct}%` }} />
          </div>
        </div>
      </div>
    </nav>
  );
}

/** Fires a desktop notification when the agent issues a new SELL/TRIM call. */
function AlertNotifier() {
  const alerts = useAlerts().data;
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!alerts) return;
    const keys = alerts.map((a) => `${a.positionId}:${a.action}:${a.rationale.slice(0, 40)}`);
    if (seen.current) {
      alerts.forEach((a, i) => {
        if (!seen.current!.has(keys[i]) && (a.action === 'SELL' || a.action === 'TRIM')) {
          window.ff?.notify(`${a.action} ${a.ticker}`, a.rationale);
        }
      });
    }
    seen.current = new Set(keys);
  }, [alerts]);
  return null;
}

export function App() {
  const [state, setState] = useState<'loading' | 'ok' | 'setup'>('loading');
  const [error, setError] = useState('');

  const check = async () => {
    await loadConfig();
    try {
      await api('/health');
      await api('/dashboard/summary'); // verifies the token too
      setState('ok');
    } catch (e: any) {
      setError(e.message);
      setState('setup');
    }
  };
  useEffect(() => {
    check();
  }, []);

  if (state === 'loading') return <div className="empty">Connecting…</div>;
  if (state === 'setup')
    return (
      <div style={{ maxWidth: 520, margin: '10vh auto', padding: 16 }}>
        <div className="brand">
          <Icon.logo />
          <div>
            <b>Finance Finder</b>
            <small>Connect to your API</small>
          </div>
        </div>
        <div className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            Couldn&apos;t reach the API{error ? `: ${error}` : ''}. Enter your Railway URL (or http://localhost:3000 in development) and the APP_API_TOKEN you set on the server.
          </p>
          <ConnectionForm onSaved={check} />
        </div>
      </div>
    );

  return (
    <ToastProvider>
      <HashRouter>
        <div className="app">
          <Sidebar />
          <AlertNotifier />
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/opportunities/:ticker" element={<OpportunityDetailPage />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/research" element={<Research />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </div>
      </HashRouter>
    </ToastProvider>
  );
}
