import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Stage } from '@ff/shared';
import { useActivity, useAlerts, useHeatmap, useMutations, useOpportunities, useSummary } from '../lib/api';
import { ago, clock, growthLabel, pct, signedMoney, tone } from '../lib/format';
import { Icon, PrioritySelect, QueryState, ScoreBar, Seg, Sparkline, StageChip, useToast } from '../components/ui';

const RAMP = ['#1A1F29', '#3A3222', '#6B5427', '#A8792E', '#E0A63D'];
function heatLevel(v: number | null) {
  if (v === null) return -1;
  if (v < 0) return 0;
  if (v < 0.5) return 1;
  if (v < 1.5) return 2;
  if (v < 4) return 3;
  return 4;
}

export function CommandCenter() {
  const summary = useSummary();
  const [stage, setStage] = useState<Stage | ''>('');
  const opps = useOpportunities({ stage });
  const activity = useActivity();
  const alerts = useAlerts();
  const heat = useHeatmap();
  const { sweep, setOppPriority } = useMutations();
  const nav = useNavigate();
  const toast = useToast();
  const s = summary.data;

  const kpis = [
    { label: 'Active signals', value: s?.activeSignals ?? '—', sub: s ? `+${s.newSignalsToday} today` : '', cls: 'up' },
    { label: 'In the early window', value: s?.earlyWindow ?? '—', sub: 'pre-saturation', cls: 'accent' },
    { label: 'Open positions', value: s?.openPositions ?? '—', sub: s?.unrealizedPnl != null ? `${signedMoney(s.unrealizedPnl)} unrealized` : '', cls: tone(s?.unrealizedPnl) },
    { label: 'Research jobs', value: s?.jobsRunning ?? '—', sub: s ? `running · ${s.jobsQueued} queued` : '', cls: 'muted' },
  ];

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Command Center</h1>
          <div className="sub">
            {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · last sweep{' '}
            <span className="mono">{ago(s?.lastSweepAt)}</span>
            {s && (
              <>
                {' '}· dataset <span className="mono">{s.datasetStats.posts.toLocaleString()}</span> posts,{' '}
                <span className="mono">{s.datasetStats.labeledOutcomes}</span> labelled outcomes
                {s.datasetStats.hitRate30d !== null && (
                  <>
                    {' '}· 14-day hit rate <span className="mono">{pct(s.datasetStats.hitRate30d, 0, false)}</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="grow" />
        <button
          className="btn primary"
          type="button"
          disabled={sweep.isPending}
          onClick={() => sweep.mutate(undefined, { onSuccess: () => toast('Sweep queued — ingesting all enabled sources') })}
        >
          <Icon.refresh />
          Run sweep now
        </button>
      </header>

      <section className="kpis" aria-label="Key figures">
        {kpis.map((k) => (
          <div key={k.label} className="panel kpi">
            <div className="muted" style={{ fontSize: 13 }}>
              {k.label}
            </div>
            <div>
              <span className="v">{k.value}</span>
              <span className={`s ${k.cls}`}>{k.sub}</span>
            </div>
          </div>
        ))}
      </section>

      <div className="two-col">
        <div className="stack">
          <section className="panel" aria-label="Top opportunities">
            <div className="panel-head bordered">
              <h2>Top opportunities</h2>
              <span className="hint">Ranked by priority, then AI score</span>
              <div className="grow" />
              <Seg
                label="Stage filter"
                value={stage}
                onChange={setStage}
                options={[
                  { value: '', label: 'All' },
                  { value: 'EMERGING', label: 'Emerging' },
                  { value: 'ACCELERATING', label: 'Accelerating' },
                  { value: 'CROWDED', label: 'Crowded' },
                ]}
              />
            </div>
            <QueryState q={opps} empty="No signals yet. Enable a source in Sources & models, then run a sweep.">
              <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Ticker</th>
                    <th>AI score</th>
                    <th>Window</th>
                    <th>Chatter 14d</th>
                    <th className="num">1D</th>
                    <th className="num">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {opps.data?.slice(0, 10).map((o, i) => (
                    <tr key={o.id} className="click" onClick={() => nav(`/opportunities/${o.ticker}`)}>
                      <td className="mono faint">{i + 1}</td>
                      <td className="ticker-cell">
                        <Link to={`/opportunities/${o.ticker}`} onClick={(e) => e.stopPropagation()} style={{ color: 'var(--text)' }}>
                          <b>
                            {o.ticker}
                            {o.isHeld && <span className="tag" style={{ marginLeft: 6 }}>held</span>}
                          </b>
                        </Link>
                        <small>{o.name ?? ''}</small>
                      </td>
                      <td>
                        <ScoreBar score={o.score} />
                      </td>
                      <td>
                        <StageChip stage={o.stage} />
                      </td>
                      <td>
                        <span className="row-flex" style={{ gap: 8 }}>
                          <Sparkline values={o.sparkline} />
                          <span className="mono blue" style={{ fontSize: 12 }}>
                            {growthLabel(o.mentionGrowth7d)}
                          </span>
                        </span>
                      </td>
                      <td className={`num ${tone(o.change1d)}`}>{pct(o.change1d)}</td>
                      <td className="num">
                        <PrioritySelect value={o.priority} onChange={(p) => setOppPriority.mutate({ ticker: o.ticker, priority: p })} label={`Priority for ${o.ticker}`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </QueryState>
          </section>

          <section className="panel panel-pad" aria-label="Where the chatter is" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row-flex" style={{ gap: 12 }}>
              <h2>Where the chatter is</h2>
              <span className="hint muted" style={{ fontSize: 12 }}>
                Mention growth vs. 30-day baseline, community × AI-assigned theme
              </span>
            </div>
            <QueryState q={heat}>
              {heat.data && heat.data.themes.length && heat.data.sources.length ? (
                <div className="heat" style={{ gridTemplateColumns: `140px repeat(${heat.data.themes.length}, minmax(0, 1fr))` }}>
                  <span />
                  {heat.data.themes.map((t) => (
                    <span key={t} className="collabel ellipsis" title={t}>
                      {t}
                    </span>
                  ))}
                  {heat.data.sources.map((src, r) => (
                    <HeatRow key={src} label={src} values={heat.data!.values[r]} />
                  ))}
                </div>
              ) : (
                <div className="empty">Themes appear after the analyst model has researched a few signals.</div>
              )}
            </QueryState>
          </section>
        </div>

        <aside className="stack">
          <section className="panel panel-pad" aria-label="Agent activity" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="row-flex" style={{ gap: 8 }}>
              <h2>Agent activity</h2>
              <span className="row-flex up" style={{ gap: 6, fontSize: 12 }}>
                <span className="dot live" style={{ width: 6, height: 6 }} />
                live
              </span>
              <div className="grow" />
              <Link to="/research" style={{ fontSize: 13 }}>
                Queue →
              </Link>
            </div>
            <QueryState q={activity} empty="Nothing has run yet.">
              {activity.data?.slice(0, 7).map((a) => (
                <div key={a.id} style={{ display: 'flex', gap: 10 }}>
                  <span className="mono faint" style={{ fontSize: 11, width: 38, flexShrink: 0, paddingTop: 2 }}>
                    {clock(a.at)}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                    <span
                      className="label-caps"
                      style={{ color: a.status === 'RUNNING' ? 'var(--up)' : a.status === 'FAILED' ? 'var(--down)' : undefined }}
                    >
                      {a.kind}
                      {a.status === 'RUNNING' ? ' · running' : ''}
                    </span>
                    <span style={{ fontSize: 13, color: '#d5dae3', overflowWrap: 'anywhere' }}>{a.text}</span>
                  </div>
                </div>
              ))}
            </QueryState>
          </section>

          <section className="panel panel-pad" aria-label="Position alerts" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="row-flex">
              <h2 className="grow">Position alerts</h2>
              <Link to="/portfolio" style={{ fontSize: 13 }}>
                Portfolio →
              </Link>
            </div>
            <QueryState q={alerts} empty="No open positions with advice yet.">
              {alerts.data?.slice(0, 4).map((a) => (
                <div key={a.positionId} className="list-item">
                  <span className={`action ${a.action}`}>{a.action}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
                      {a.ticker} · <span className={tone(a.pnlPct)}>{pct(a.pnlPct)}</span>
                    </span>
                    <span style={{ fontSize: 12, color: '#a3acbc' }}>{a.rationale}</span>
                  </div>
                </div>
              ))}
            </QueryState>
          </section>
        </aside>
      </div>
    </main>
  );
}

function HeatRow({ label, values }: { label: string; values: (number | null)[] }) {
  return (
    <>
      <span className="rowlabel ellipsis">{label}</span>
      {values.map((v, i) => {
        const l = heatLevel(v);
        return (
          <span key={i} className="cell" style={{ background: l < 0 ? 'transparent' : RAMP[l], color: l >= 3 ? '#140F04' : '#C9CFDA' }}>
            {v === null ? '' : pct(v, 0)}
          </span>
        );
      })}
    </>
  );
}
