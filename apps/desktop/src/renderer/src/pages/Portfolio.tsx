import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PositionDto } from '@ff/shared';
import { useMutations, usePositions } from '../lib/api';
import { ago, money, pct, signedMoney, tone } from '../lib/format';
import { Icon, Modal, QueryState, Seg, useToast } from '../components/ui';
import { PositionModal } from '../components/PositionModal';

export function Portfolio() {
  const [view, setView] = useState<'open' | 'all'>('open');
  const q = usePositions(view === 'all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = q.data ?? [];
  const open = rows.filter((p) => !p.closedAt);
  const selected = rows.find((p) => p.id === selectedId) ?? open[0] ?? rows[0];

  const value = open.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  const cost = open.reduce((s, p) => s + p.entryPrice * p.quantity, 0);
  const pnl = open.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const needAction = open.filter((p) => p.advice && p.advice.action !== 'HOLD').length;

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Portfolio</h1>
          <div className="sub">Positions you marked as invested. The agent re-reviews each one on a schedule and advises add / hold / trim / sell.</div>
        </div>
        <div className="grow" />
        <Seg label="Show" value={view} onChange={setView} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'Include closed' }]} />
        <button className="btn primary" type="button" onClick={() => setAdding(true)}>
          <Icon.plus />
          Add position
        </button>
      </header>

      <section className="kpis" aria-label="Portfolio totals">
        <Kpi label="Market value" value={money(value, 0)} />
        <Kpi label="Cost basis" value={money(cost, 0)} />
        <Kpi label="Unrealized P/L" value={signedMoney(pnl)} sub={cost ? pct(pnl / cost) : ''} cls={tone(pnl)} />
        <Kpi label="Need attention" value={String(needAction)} sub="trim / sell / add calls" cls="accent" />
      </section>

      <div className="two-col">
        <section className="panel">
          <QueryState q={q} empty="No positions yet. Use “Mark as invested” on an opportunity, or Add position.">
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th className="num">Shares</th>
                    <th className="num">Entry</th>
                    <th className="num">Price</th>
                    <th className="num">Value</th>
                    <th className="num">P/L</th>
                    <th>AI advice</th>
                    <th className="num">Reviewed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr
                      key={p.id}
                      className="click"
                      onClick={() => setSelectedId(p.id)}
                      aria-selected={selected?.id === p.id}
                      style={selected?.id === p.id ? { background: '#161B24' } : undefined}
                    >
                      <td className="ticker-cell">
                        <b>
                          {p.ticker}
                          {p.closedAt && <span className="tag" style={{ marginLeft: 6 }}>closed</span>}
                        </b>
                        <small>{p.name ?? ''}</small>
                      </td>
                      <td className="num">{p.quantity.toLocaleString()}</td>
                      <td className="num">{money(p.entryPrice)}</td>
                      <td className="num">{money(p.price)}</td>
                      <td className="num">{money(p.marketValue, 0)}</td>
                      <td className={`num ${tone(p.pnl)}`}>
                        {signedMoney(p.pnl)} <span style={{ fontSize: 12 }}>({pct(p.pnlPct)})</span>
                      </td>
                      <td>{p.advice ? <span className={`action ${p.advice.action}`}>{p.advice.action}</span> : <span className="muted">pending</span>}</td>
                      <td className="num muted" style={{ fontSize: 12 }}>
                        {ago(p.advice?.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </section>
        {selected && <PositionPanel p={selected} />}
      </div>
      {adding && <PositionModal onClose={() => setAdding(false)} />}
    </main>
  );
}

function Kpi({ label, value, sub, cls }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="panel kpi">
      <div className="muted" style={{ fontSize: 13 }}>
        {label}
      </div>
      <div>
        <span className="v">{value}</span>
        {sub && <span className={`s ${cls ?? 'muted'}`}>{sub}</span>}
      </div>
    </div>
  );
}

function PositionPanel({ p }: { p: PositionDto }) {
  const { reviewPosition, closePosition, deletePosition } = useMutations();
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [exit, setExit] = useState('');

  const onClose = async (e: FormEvent) => {
    e.preventDefault();
    await closePosition.mutateAsync({ id: p.id, exitPrice: Number(exit) });
    toast(`${p.ticker} closed`);
    setClosing(false);
  };

  return (
    <aside className="panel panel-pad" aria-label={`${p.ticker} details`} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="row-flex">
        <h2 className="mono grow" style={{ fontSize: 20 }}>
          {p.ticker}
        </h2>
        {p.opportunityId && (
          <Link to={`/opportunities/${p.ticker}`} style={{ fontSize: 13 }}>
            Research →
          </Link>
        )}
      </div>
      {p.advice ? (
        <>
          <div className="row-flex">
            <span className={`action ${p.advice.action}`} style={{ fontSize: 14, padding: '6px 12px' }}>
              {p.advice.action}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {Math.round(p.advice.confidence * 100)}% confidence · {ago(p.advice.createdAt)}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#d5dae3' }}>{p.advice.rationale}</p>
          <div className="grid-2">
            <Stat label="Suggested stop" value={money(p.advice.stopLoss)} />
            <Stat label="Take profit" value={money(p.advice.takeProfit)} />
          </div>
        </>
      ) : (
        <div className="muted" style={{ fontSize: 13 }}>
          Waiting for the first review. Make sure an Analyst model is configured in Sources &amp; models.
        </div>
      )}
      <div className="grid-2">
        <Stat label="Entry" value={`${money(p.entryPrice)} · ${p.entryDate}`} />
        <Stat label="P/L" value={`${signedMoney(p.pnl)} (${pct(p.pnlPct)})`} cls={tone(p.pnl)} />
      </div>
      {p.notes && (
        <div>
          <div className="label-caps">Your notes</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>{p.notes}</div>
        </div>
      )}
      {!p.closedAt && (
        <div className="row-flex" style={{ flexWrap: 'wrap' }}>
          <button className="btn" type="button" disabled={reviewPosition.isPending} onClick={() => reviewPosition.mutate(p.id, { onSuccess: () => toast(`Review of ${p.ticker} queued`) })}>
            Review now
          </button>
          <button className="btn" type="button" onClick={() => { setExit(p.price ? String(p.price) : ''); setClosing(true); }}>
            Close position
          </button>
          <button
            className="btn danger"
            type="button"
            onClick={() => {
              if (confirm(`Delete ${p.ticker} position and its advice history?`)) deletePosition.mutate(p.id);
            }}
          >
            Delete
          </button>
        </div>
      )}
      {closing && (
        <Modal title={`Close ${p.ticker}`} onClose={() => setClosing(false)}>
          <form onSubmit={onClose} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="field">
              Exit price ($)
              <input className="input mono" type="number" step="any" min="0" required value={exit} onChange={(e) => setExit(e.target.value)} />
            </label>
            <div className="row-flex" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" type="button" onClick={() => setClosing(false)}>
                Cancel
              </button>
              <button className="btn primary" type="submit">
                Close position
              </button>
            </div>
          </form>
        </Modal>
      )}
    </aside>
  );
}

const Stat = ({ label, value, cls }: { label: string; value: string; cls?: string }) => (
  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px' }}>
    <div className="label-caps">{label}</div>
    <div className={`mono ${cls ?? ''}`} style={{ fontSize: 14, marginTop: 2 }}>
      {value}
    </div>
  </div>
);
