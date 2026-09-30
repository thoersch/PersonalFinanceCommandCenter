import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ScoreBreakdown } from '@ff/shared';
import { useMutations, useOpportunity } from '../lib/api';
import { ago, inTime, JOB_LABEL, money, pct, tone } from '../lib/format';
import { ExtLink, PrioritySelect, QueryState, Seg, StageChip, useToast } from '../components/ui';
import { PositionModal } from '../components/PositionModal';

const FACTORS: { key: keyof ScoreBreakdown; label: string; color: string }[] = [
  { key: 'momentum', label: 'Chatter momentum', color: 'var(--blue)' },
  { key: 'earlyWindow', label: 'Early window (low saturation)', color: 'var(--accent)' },
  { key: 'catalyst', label: 'Catalyst proximity', color: 'var(--accent)' },
  { key: 'sourceQuality', label: 'Source quality', color: '#a3acbc' },
  { key: 'fundamentals', label: 'Fundamentals check', color: '#a3acbc' },
];

export function OpportunityDetailPage() {
  const { ticker } = useParams();
  const q = useOpportunity(ticker);
  const { setOppPriority, researchNow, patchOpp } = useMutations();
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const [showInvest, setShowInvest] = useState(false);
  const toast = useToast();
  const o = q.data;

  const series = useMemo(() => (o ? o.series.slice(-Number(range)) : []), [o, range]);
  const flagDay = o?.firstFlaggedAt.slice(0, 10);
  const satSteps = o ? Math.max(1, Math.round(o.saturation * 5)) : 0;

  return (
    <main className="page">
      <QueryState q={q}>
        {o && (
          <>
            <header style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
                <div className="crumbs grow">
                  <Link to="/opportunities">Opportunities</Link> / <span className="mono">{o.ticker}</span>
                </div>
                <PrioritySelect value={o.priority} onChange={(p) => setOppPriority.mutate({ ticker: o.ticker, priority: p })} label={`Priority for ${o.ticker}`} />
                <button className="btn" type="button" onClick={() => patchOpp.mutate({ ticker: o.ticker, watch: !o.watch })} aria-pressed={o.watch}>
                  {o.watch ? 'Watching' : 'Watch'}
                </button>
                <button
                  className="btn"
                  type="button"
                  disabled={researchNow.isPending}
                  onClick={() => researchNow.mutate(o.ticker, { onSuccess: () => toast(`Deep dive on ${o.ticker} queued at top priority`) })}
                >
                  Re-research now
                </button>
                <button className="btn primary" type="button" onClick={() => setShowInvest(true)}>
                  Mark as invested
                </button>
              </div>
              <div className="row-flex" style={{ gap: 18, flexWrap: 'wrap' }}>
                <h1 className="mono" style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>
                  {o.ticker}
                </h1>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{o.name ?? 'Unknown company'}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {[o.exchange, o.sector].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                <div className="row-flex" style={{ alignItems: 'baseline', gap: 8 }}>
                  <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>
                    {money(o.price)}
                  </span>
                  <span className={`mono ${tone(o.change1d)}`}>
                    {o.change1d !== null && (o.change1d >= 0 ? '▲ ' : '▼ ')}
                    {pct(o.change1d)} today
                  </span>
                </div>
                <StageChip stage={o.stage} />
                {o.isHeld && <span className="tag">You hold this</span>}
              </div>
            </header>

            <div className="two-col">
              <section className="panel panel-pad" aria-label="Price versus chatter" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="row-flex" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <h2>Price vs. chatter</h2>
                  <Legend swatch={<span style={{ width: 14, height: 2, background: 'var(--text)' }} />} label="Close" />
                  <Legend swatch={<span style={{ width: 10, height: 10, background: '#3F6DAA', borderRadius: 2 }} />} label="Mentions / day" />
                  <Legend swatch={<span style={{ height: 12, borderLeft: '2px dashed var(--accent)' }} />} label="First flagged" />
                  <div className="grow" />
                  <Seg label="Range" value={range} onChange={setRange} options={[{ value: '7', label: '7D' }, { value: '30', label: '30D' }, { value: '90', label: '90D' }]} />
                </div>
                <div style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke="#1E2530" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: '#7F8A9C', fontSize: 11, fontFamily: 'IBM Plex Mono' }} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} axisLine={{ stroke: '#1E2530' }} tickLine={false} />
                      <YAxis yAxisId="p" orientation="left" domain={['auto', 'auto']} tick={{ fill: '#7F8A9C', fontSize: 11, fontFamily: 'IBM Plex Mono' }} tickFormatter={(v: number) => `$${v}`} width={52} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="m" orientation="right" tick={{ fill: '#7F8A9C', fontSize: 11, fontFamily: 'IBM Plex Mono' }} width={36} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: '#1B2130', border: '1px solid #2A3342', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: '#E6E9EF' }}
                        formatter={(v: any, n: any) => (n === 'close' ? [money(v), 'Close'] : [v, 'Mentions'])}
                      />
                      <Bar yAxisId="m" dataKey="mentions" fill="#3F6DAA" opacity={0.8} radius={[2, 2, 0, 0]} />
                      <Line yAxisId="p" type="monotone" dataKey="close" stroke="#E6E9EF" strokeWidth={2} dot={false} connectNulls />
                      {flagDay && series.some((p) => p.date === flagDay) && (
                        <ReferenceLine yAxisId="p" x={flagDay} stroke="#F2B544" strokeDasharray="4 4" />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="panel panel-pad" aria-label="AI score breakdown" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div className="row-flex" style={{ gap: 14 }}>
                  <div style={{ width: 72, height: 72, borderRadius: 36, border: '5px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="mono" style={{ fontSize: 26, fontWeight: 600 }}>
                      {o.score ?? '—'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>AI score</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Confidence: {o.thesis?.confidence?.replace('_', '-').toLowerCase() ?? 'not researched yet'}
                    </span>
                    {o.history[0]?.previousScore != null && o.history[0].score != null && (
                      <span className={`mono ${tone(o.history[0].score - o.history[0].previousScore)}`} style={{ fontSize: 12 }}>
                        {o.history[0].score >= o.history[0].previousScore ? '▲' : '▼'} {Math.abs(Math.round(o.history[0].score - o.history[0].previousScore))} since last run
                      </span>
                    )}
                  </div>
                </div>
                {o.breakdown ? (
                  FACTORS.map((f) => (
                    <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      <div className="row-flex" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-2)' }}>{f.label}</span>
                        <span className="mono">{Math.round(o.breakdown![f.key])}</span>
                      </div>
                      <div className="bar">
                        <span style={{ width: `${o.breakdown![f.key]}%`, background: f.color }} />
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Breakdown appears after the first deep dive.
                  </div>
                )}
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="row-flex" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-2)' }}>Saturation</span>
                    <span className="accent">{satSteps} of 5</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }} aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} style={{ flex: 1, height: 8, borderRadius: 2, background: i < satSteps ? 'var(--accent)' : '#262D3A' }} />
                    ))}
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {o.uniqueAuthors7d} unique authors · {o.mentions7d} mentions this week · flagged {ago(o.firstFlaggedAt)}
                  </span>
                </div>
              </section>
            </div>

            <div className="three-col">
              <section className="panel panel-pad" aria-label="AI thesis" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row-flex">
                  <h2 className="grow">AI thesis</h2>
                  <span className="muted" style={{ fontSize: 12 }}>
                    updated {ago(o.lastResearchedAt)}
                  </span>
                </div>
                {o.thesis ? (
                  <>
                    <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: '#d5dae3' }}>{o.thesis.summary}</p>
                    <ThesisList title="Bull case" color="var(--up)" mark="▲" items={o.thesis.bull} />
                    <ThesisList title="Risks" color="var(--down)" mark="▼" items={o.thesis.bear} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="label-caps accent">Catalysts</span>
                      {o.thesis.catalysts.length ? (
                        o.thesis.catalysts.map((c, i) => (
                          <span key={i} style={{ fontSize: 13, color: 'var(--text-2)' }}>
                            <span className="mono" style={{ color: 'var(--text)' }}>
                              {c.date}
                            </span>{' '}
                            · {c.label}
                          </span>
                        ))
                      ) : (
                        <span className="muted" style={{ fontSize: 13 }}>
                          None identified
                        </span>
                      )}
                    </div>
                    <span className="muted" style={{ fontSize: 12 }}>
                      Horizon: {o.thesis.horizon}
                    </span>
                  </>
                ) : (
                  <div className="muted" style={{ fontSize: 13 }}>
                    Not researched yet. Use “Re-research now” or wait for the next sweep.
                  </div>
                )}
              </section>

              <section className="panel panel-pad" aria-label="Sources" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="row-flex">
                  <h2 className="grow">Sources</h2>
                  <span className="mono muted" style={{ fontSize: 12 }}>
                    {o.sources.length} linked
                  </span>
                </div>
                {o.sources.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No linked sources yet.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 460, overflow: 'auto' }}>
                  {o.sources.map((s) => (
                    <div key={s.id} className="list-item" style={{ flexDirection: 'column', gap: 4 }}>
                      <span className="row-flex" style={{ gap: 8, fontSize: 11 }}>
                        <span style={{ fontWeight: 600, color: s.kind === 'POST' ? 'var(--accent)' : 'var(--blue)' }}>{s.source}</span>
                        <span className="faint">· {ago(s.publishedAt)}</span>
                        <span className="grow" />
                        {s.tag && <span className="tag">{s.tag}</span>}
                      </span>
                      <span style={{ fontSize: 13 }}>
                        <ExtLink href={s.url}>
                          <span style={{ color: 'var(--text)' }}>{s.title}</span>
                        </ExtLink>
                      </span>
                      <span className="mono faint ellipsis" style={{ fontSize: 11 }}>
                        {s.meta}
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="panel panel-pad" aria-label="Research history" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row-flex">
                  <h2 className="grow">Research history</h2>
                  <span className="muted" style={{ fontSize: 12 }}>
                    next run <span className="mono" style={{ color: 'var(--text)' }}>{inTime(o.nextResearchAt)}</span>
                  </span>
                </div>
                {o.history.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No analyses yet.</div>}
                {o.history.map((h, i) => (
                  <div key={h.id} style={{ display: 'flex', gap: 12 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 10, paddingTop: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, border: `2px solid ${i === 0 ? 'var(--up)' : h.kind === 'POSITION_REVIEW' ? 'var(--blue)' : '#a3acbc'}` }} />
                      <span style={{ width: 2, flex: 1, background: 'var(--line)', marginTop: 4 }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingBottom: 6, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {JOB_LABEL[h.kind] ?? h.kind}
                        {h.score !== null && ` · score ${h.previousScore !== null ? `${Math.round(h.previousScore)} → ` : ''}${Math.round(h.score)}`}
                      </span>
                      <span style={{ fontSize: 12, color: '#a3acbc' }}>{h.summary}</span>
                      <span className="mono faint" style={{ fontSize: 11 }}>
                        {new Date(h.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {h.provider}/{h.model}
                      </span>
                    </div>
                  </div>
                ))}
              </section>
            </div>
            {showInvest && <PositionModal ticker={o.ticker} price={o.price} onClose={() => setShowInvest(false)} />}
          </>
        )}
      </QueryState>
    </main>
  );
}

const Legend = ({ swatch, label }: { swatch: React.ReactNode; label: string }) => (
  <span className="row-flex" style={{ gap: 6, fontSize: 12, color: '#a3acbc' }}>
    {swatch}
    {label}
  </span>
);

function ThesisList({ title, color, mark, items }: { title: string; color: string; mark: string; items: string[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="label-caps" style={{ color }}>
        {title}
      </span>
      {items.length ? (
        items.map((b, i) => (
          <span key={i} style={{ fontSize: 13, color: 'var(--text-2)' }}>
            <span style={{ color }}>{mark}</span> {b}
          </span>
        ))
      ) : (
        <span className="muted" style={{ fontSize: 13 }}>
          —
        </span>
      )}
    </div>
  );
}
