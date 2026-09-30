import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppSettings, useJobs, useMutations, useSummary } from '../lib/api';
import { ago, inTime, JOB_LABEL, money, pct } from '../lib/format';
import { PrioritySelect, QueryState, Seg, Toggle, useToast } from '../components/ui';

type Tab = 'active' | 'done' | 'failed';
const STATUS: Record<Tab, string> = { active: 'RUNNING,QUEUED', done: 'DONE', failed: 'FAILED,CANCELLED' };

export function Research() {
  const [tab, setTab] = useState<Tab>('active');
  const jobs = useJobs(STATUS[tab]);
  const summary = useSummary().data;
  const app = useAppSettings().data;
  const { setJobPriority, cancelJob, retryJob, updateApp } = useMutations();
  const toast = useToast();

  const sorted = (jobs.data ?? []).slice().sort((a, b) => (a.status === 'RUNNING' ? -1 : 0) - (b.status === 'RUNNING' ? -1 : 0));

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Research queue</h1>
          <div className="sub">What the agent is working on, what&apos;s next, and what it finished. Override priority to jump the queue or pause a job.</div>
        </div>
      </header>

      <div className="two-col">
        <section className="panel">
          <div className="panel-head bordered">
            <Seg
              label="Jobs"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'active', label: `Running & queued${summary ? ` (${summary.jobsRunning + summary.jobsQueued})` : ''}` },
                { value: 'done', label: 'Completed' },
                { value: 'failed', label: 'Failed' },
              ]}
            />
          </div>
          <QueryState q={jobs} empty={tab === 'active' ? 'Queue is empty — the next sweep will add work.' : 'Nothing here.'}>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th style={{ width: '30%' }}>Detail</th>
                    <th>Model</th>
                    <th className="num">Cost</th>
                    <th className="num">{tab === 'active' ? 'Queued' : 'Finished'}</th>
                    <th className="num">Priority</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((j) => (
                    <tr key={j.id}>
                      <td style={{ fontWeight: 500 }}>{JOB_LABEL[j.type] ?? j.type}</td>
                      <td className="mono">
                        {j.type === 'DEEP_DIVE' && j.target ? <Link to={`/opportunities/${j.target}`}>{j.target}</Link> : j.type === 'POSITION_REVIEW' ? <Link to="/portfolio">position</Link> : (j.target ?? '—')}
                      </td>
                      <td>
                        {j.status === 'RUNNING' ? (
                          <span className="row-flex" style={{ gap: 8 }}>
                            <span className="dot live" />
                            <span className="bar" style={{ width: 60 }}>
                              <span style={{ width: pct(j.progress, 0, false), background: 'var(--up)' }} />
                            </span>
                          </span>
                        ) : (
                          <span className={j.status === 'FAILED' ? 'down' : j.status === 'DONE' ? 'up' : 'muted'} style={{ fontSize: 12 }}>
                            {j.status.toLowerCase()}
                            {j.status === 'QUEUED' && new Date(j.runAfter) > new Date() ? ` · ${inTime(j.runAfter)}` : ''}
                          </span>
                        )}
                      </td>
                      <td style={{ whiteSpace: 'normal', fontSize: 12, color: j.status === 'FAILED' ? 'var(--down)' : '#a3acbc', maxWidth: 360 }}>
                        {j.status === 'FAILED' ? (j.error ?? j.message) : j.message}
                      </td>
                      <td className="mono muted" style={{ fontSize: 12 }}>
                        {j.model ?? '—'}
                      </td>
                      <td className="num muted" style={{ fontSize: 12 }}>
                        {j.costUsd ? money(j.costUsd, 3) : '—'}
                      </td>
                      <td className="num muted" style={{ fontSize: 12 }}>
                        {ago(tab === 'active' ? j.createdAt : j.finishedAt)}
                      </td>
                      <td className="num">
                        {j.status === 'QUEUED' ? (
                          <PrioritySelect value={j.priorityOverride ?? 'AUTO'} onChange={(p) => setJobPriority.mutate({ id: j.id, priority: p })} label={`Priority for job ${j.target ?? j.type}`} />
                        ) : (
                          <span className="mono muted">{j.priority}</span>
                        )}
                      </td>
                      <td className="num">
                        {j.status === 'QUEUED' && (
                          <button className="btn ghost sm" type="button" onClick={() => cancelJob.mutate(j.id)}>
                            Cancel
                          </button>
                        )}
                        {(j.status === 'FAILED' || j.status === 'CANCELLED') && (
                          <button className="btn sm" type="button" onClick={() => retryJob.mutate(j.id, { onSuccess: () => toast('Re-queued') })}>
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </QueryState>
        </section>

        <aside className="stack">
          <section className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }} aria-label="Autonomy">
            <div className="row-flex">
              <h2 className="grow">Autonomy</h2>
              {app && <Toggle label="Autonomous mode" checked={app.autonomous} onChange={(v) => updateApp.mutate({ autonomous: v })} />}
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              When on, the agent ingests sources on their schedules, sweeps every {app?.sweepIntervalMin ?? '—'} min, and decides what to research. Manual actions work either way.
            </p>
            <div className="row-flex muted" style={{ justifyContent: 'space-between', fontSize: 12 }}>
              <span>Next sweep</span>
              <span className="mono" style={{ color: 'var(--text)' }}>
                {summary?.autonomous ? inTime(summary.nextSweepAt) : 'paused'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="row-flex muted" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span>AI spend today</span>
                <span className="mono" style={{ color: 'var(--text)' }}>
                  {money(summary?.spendTodayUsd ?? 0)} / {money(summary?.dailyBudgetUsd ?? 0, 0)}
                </span>
              </div>
              <div className="bar">
                <span style={{ width: `${summary && summary.dailyBudgetUsd ? Math.min(100, (summary.spendTodayUsd / summary.dailyBudgetUsd) * 100) : 0}%` }} />
              </div>
            </div>
            <Link to="/settings" style={{ fontSize: 13 }}>
              Tune schedule &amp; budget →
            </Link>
          </section>

          <section className="panel panel-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-label="Internal dataset">
            <h2>Internal dataset</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Every post, mention and daily price is kept. After 7/14/30 days each signal is labelled with what the stock actually did, and those results are fed back into scoring.
            </p>
            {summary && (
              <div className="grid-2">
                <DS label="Posts" v={summary.datasetStats.posts.toLocaleString()} />
                <DS label="Mentions" v={summary.datasetStats.mentions.toLocaleString()} />
                <DS label="Tickers seen" v={summary.datasetStats.tickers.toLocaleString()} />
                <DS label="Labelled outcomes" v={summary.datasetStats.labeledOutcomes.toLocaleString()} />
                <DS label="14-day hit rate (30d)" v={summary.datasetStats.hitRate30d === null ? 'warming up' : pct(summary.datasetStats.hitRate30d, 0, false)} />
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

const DS = ({ label, v }: { label: string; v: string }) => (
  <div style={{ background: 'var(--panel-2)', borderRadius: 8, padding: '10px 12px' }}>
    <div className="label-caps">{label}</div>
    <div className="mono" style={{ fontSize: 16, marginTop: 2 }}>
      {v}
    </div>
  </div>
);
