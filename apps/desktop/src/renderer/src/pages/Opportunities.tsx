import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Stage } from '@ff/shared';
import { useAppSettings, useMutations, useOpportunities } from '../lib/api';
import { ago, growthLabel, money, pct, tone } from '../lib/format';
import { Icon, PrioritySelect, QueryState, ScoreBar, Seg, Sparkline, StageChip, Toggle, useToast } from '../components/ui';

export function Opportunities() {
  const [stage, setStage] = useState<Stage | ''>('');
  const [q, setQ] = useState('');
  const [add, setAdd] = useState('');
  const [bandOnly, setBandOnly] = useState(true);
  const app = useAppSettings().data;
  const band = app ? priceBandLabel(app.minSharePrice, app.maxSharePrice) : null;
  const opps = useOpportunities({ stage, q, inPriceBand: !!band && bandOnly });
  const { setOppPriority, patchOpp, track } = useMutations();
  const nav = useNavigate();
  const toast = useToast();

  const onTrack = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const d = await track.mutateAsync({ ticker: add });
      toast(`Tracking ${d.ticker} — deep dive queued`);
      setAdd('');
      nav(`/opportunities/${d.ticker}`);
    } catch (err: any) {
      toast(err.message, true);
    }
  };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Opportunities</h1>
          <div className="sub">Every ticker the agent is following. Set a priority to steer what it researches next.</div>
        </div>
        <div className="grow" />
        <form onSubmit={onTrack} className="row-flex" style={{ gap: 8 }}>
          <label htmlFor="track" className="sr-only">
            Ticker to track
          </label>
          <input id="track" className="input mono" placeholder="Track a ticker…" value={add} onChange={(e) => setAdd(e.target.value)} style={{ width: 160 }} maxLength={10} />
          <button className="btn" type="submit" disabled={!add || track.isPending}>
            <Icon.plus />
            Track
          </button>
        </form>
      </header>

      <section className="panel">
        <div className="panel-head bordered">
          <label htmlFor="oq" className="sr-only">
            Filter by ticker
          </label>
          <input id="oq" className="input" type="search" placeholder="Filter by ticker…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          {band && (
            <div className="row-flex" style={{ gap: 8, fontSize: 12 }}>
              <Toggle label={`Only ${band}`} checked={bandOnly} onChange={setBandOnly} />
              <span className="muted">Only {band}</span>
            </div>
          )}
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
              { value: 'FADING', label: 'Fading' },
            ]}
          />
        </div>
        <QueryState q={opps} empty="Nothing matches.">
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>AI score</th>
                  <th>Window</th>
                  <th>Chatter 14d</th>
                  <th className="num">24h</th>
                  <th className="num">7d</th>
                  <th className="num">Authors</th>
                  <th className="num">Sentiment</th>
                  <th className="num">Price</th>
                  <th className="num">1D</th>
                  <th className="num">Flagged</th>
                  <th className="num">Researched</th>
                  <th className="num">Priority</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {opps.data?.map((o) => (
                  <tr key={o.id} className="click" onClick={() => nav(`/opportunities/${o.ticker}`)}>
                    <td className="ticker-cell">
                      <b>
                        {o.ticker}
                        {o.isHeld && <span className="tag" style={{ marginLeft: 6 }}>held</span>}
                      </b>
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
                    <td className="num">{o.mentions24h}</td>
                    <td className="num">{o.mentions7d}</td>
                    <td className="num">{o.uniqueAuthors7d}</td>
                    <td className={`num ${tone(o.sentiment)}`}>{o.sentiment === null ? '—' : o.sentiment.toFixed(2)}</td>
                    <td className="num">{money(o.price)}</td>
                    <td className={`num ${tone(o.change1d)}`}>{pct(o.change1d)}</td>
                    <td className="num muted" style={{ fontSize: 12 }}>
                      {ago(o.firstFlaggedAt)}
                    </td>
                    <td className="num muted" style={{ fontSize: 12 }}>
                      {ago(o.lastResearchedAt)}
                    </td>
                    <td className="num">
                      <PrioritySelect value={o.priority} onChange={(p) => setOppPriority.mutate({ ticker: o.ticker, priority: p })} label={`Priority for ${o.ticker}`} />
                    </td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn ghost sm"
                        aria-label={`Dismiss ${o.ticker}`}
                        title="Dismiss — stop tracking"
                        onClick={(e) => {
                          e.stopPropagation();
                          patchOpp.mutate({ ticker: o.ticker, dismissed: true });
                          toast(`${o.ticker} dismissed`);
                        }}
                      >
                        <Icon.x />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryState>
      </section>
    </main>
  );
}

function priceBandLabel(lo: number | null, hi: number | null): string | null {
  if (lo !== null && hi !== null) return `${money(lo)}–${money(hi)}`;
  if (hi !== null) return `under ${money(hi)}`;
  if (lo !== null) return `over ${money(lo)}`;
  return null;
}
