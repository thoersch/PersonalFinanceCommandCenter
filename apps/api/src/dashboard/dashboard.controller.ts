import { Controller, Get } from '@nestjs/common';
import { and, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { ActivityItem, DashboardSummary, HeatmapDto, JobStatus, PositionAlert } from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { jobs, mentions, opportunities, outcomes, posts } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { hoursAgo } from '../common/http';
import { Public } from '../common/auth.guard';
import { PositionsService } from '../positions/positions.service';
import { JobsService } from '../research/jobs.service';
import { OrchestratorService } from '../research/orchestrator.service';
import { OutcomesService } from '../research/outcomes.service';
import { SettingsService } from '../settings/settings.service';

const JOB_LABEL: Record<string, string> = {
  INGEST: 'INGEST',
  AGGREGATE: 'SWEEP',
  SENTIMENT: 'SENTIMENT',
  DEEP_DIVE: 'DEEP DIVE',
  POSITION_REVIEW: 'POSITION REVIEW',
  OUTCOME_LABEL: 'LEARNING',
};

@Controller()
export class DashboardController {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly orchestrator: OrchestratorService,
    private readonly positions: PositionsService,
    private readonly outcomes: OutcomesService,
    private readonly ai: AiService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { ok: true, time: new Date().toISOString() };
  }

  @Get('dashboard/summary')
  async summary(): Promise<DashboardSummary> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const [app, counts, lastSweep, nextSweep, spend, pos, hitRate] = await Promise.all([
      this.settings.getApp(),
      this.jobs.counts(),
      this.jobs.lastFinished('AGGREGATE'),
      this.orchestrator.nextSweepAt(),
      this.ai.spendToday(),
      this.positions.list(false),
      this.outcomes.hitRate30d(),
    ]);
    const [opp] = await this.db
      .select({
        active: sql<number>`count(*) FILTER (WHERE ${opportunities.stage} <> 'FADING')::int`,
        newToday: sql<number>`count(*) FILTER (WHERE ${opportunities.firstFlaggedAt} >= ${start})::int`,
        early: sql<number>`count(*) FILTER (WHERE ${opportunities.stage} = 'EMERGING')::int`,
      })
      .from(opportunities)
      .where(eq(opportunities.dismissed, false));
    const [ds] = await this.db
      .select({
        posts: sql<number>`(SELECT count(*) FROM ${posts})::int`,
        mentions: sql<number>`(SELECT count(*) FROM ${mentions})::int`,
        tickers: sql<number>`(SELECT count(DISTINCT ticker) FROM ${mentions})::int`,
        labeled: sql<number>`(SELECT count(*) FROM ${outcomes})::int`,
      })
      .from(sql`(SELECT 1) x`);
    const pnl = pos.reduce((s, p) => (p.pnl === null ? s : (s ?? 0) + p.pnl), null as number | null);
    return {
      activeSignals: opp.active,
      newSignalsToday: opp.newToday,
      earlyWindow: opp.early,
      openPositions: pos.length,
      unrealizedPnl: pnl,
      jobsRunning: counts.running,
      jobsQueued: counts.queued,
      lastSweepAt: lastSweep?.toISOString() ?? null,
      nextSweepAt: nextSweep?.toISOString() ?? null,
      autonomous: app.autonomous,
      spendTodayUsd: spend,
      dailyBudgetUsd: app.dailyBudgetUsd,
      datasetStats: { posts: ds.posts, mentions: ds.mentions, tickers: ds.tickers, labeledOutcomes: ds.labeled, hitRate30d: hitRate },
    };
  }

  @Get('dashboard/activity')
  async activity(): Promise<ActivityItem[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(and(ne(jobs.status, 'QUEUED'), gte(jobs.createdAt, hoursAgo(48))))
      .orderBy(desc(sql`coalesce(${jobs.finishedAt}, ${jobs.startedAt}, ${jobs.createdAt})`))
      .limit(25);
    return rows.map((r) => ({
      id: r.id,
      at: (r.finishedAt ?? r.startedAt ?? r.createdAt).toISOString(),
      kind: `${JOB_LABEL[r.type] ?? r.type}${r.target && r.type !== 'POSITION_REVIEW' ? ` · ${r.target}` : ''}`,
      status: r.status as JobStatus,
      text: r.status === 'FAILED' ? `Failed: ${r.error ?? r.message ?? ''}` : (r.message ?? ''),
    }));
  }

  @Get('dashboard/alerts')
  async alerts(): Promise<PositionAlert[]> {
    const order = { SELL: 0, TRIM: 1, ADD: 2, HOLD: 3 } as const;
    return (await this.positions.list(false))
      .filter((p) => p.advice)
      .map((p) => ({ positionId: p.id, ticker: p.ticker, action: p.advice!.action, pnlPct: p.pnlPct, rationale: p.advice!.rationale }))
      .sort((a, b) => order[a.action] - order[b.action]);
  }

  /** Mention growth by community × AI-assigned theme. */
  @Get('dashboard/heatmap')
  async heatmap(): Promise<HeatmapDto> {
    const opps = await this.db
      .select({ t: opportunities.ticker, themes: opportunities.themes })
      .from(opportunities)
      .where(and(eq(opportunities.dismissed, false), ne(opportunities.stage, 'FADING')));
    const themeCount = new Map<string, string[]>();
    for (const o of opps) for (const th of o.themes) themeCount.set(th, [...(themeCount.get(th) ?? []), o.t]);
    const themes = [...themeCount.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const chanRes = await this.db
      .select({ c: mentions.channel, n: sql<number>`count(*)::int` })
      .from(mentions)
      .where(gte(mentions.postedAt, hoursAgo(24 * 7)))
      .groupBy(mentions.channel)
      .orderBy(desc(sql`count(*)`))
      .limit(6);
    const channels = chanRes.map((c) => c.c);
    const values: (number | null)[][] = [];
    for (const ch of channels) {
      const row: (number | null)[] = [];
      for (const [, tick] of themes) {
        const [r] = await this.db
          .select({
            recent: sql<number>`count(*) FILTER (WHERE ${mentions.postedAt} >= now() - interval '7 days')::float`,
            base: sql<number>`(count(*) FILTER (WHERE ${mentions.postedAt} < now() - interval '7 days'))::float / 30 * 7`,
          })
          .from(mentions)
          .where(and(eq(mentions.channel, ch), inArray(mentions.ticker, tick), gte(mentions.postedAt, hoursAgo(24 * 37))));
        row.push(r.recent + r.base === 0 ? null : (r.recent - r.base) / Math.max(r.base, 1));
      }
      values.push(row);
    }
    return { themes: themes.map(([t]) => t), sources: channels, values };
  }
}
