import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { and, asc, desc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { JobType } from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { opportunities, positions } from '../db/schema';
import { AiService, BudgetExceededError, RoleNotConfiguredError } from '../ai/ai.service';
import { ConfigError } from '../common/http';
import { IngestService } from '../ingest/ingest.service';
import { SettingsService } from '../settings/settings.service';
import { effectivePriority, inPriceBand, SignalsService } from '../signals/signals.service';
import { JobsService, LANES } from './jobs.service';
import { OutcomesService } from './outcomes.service';
import { HandlerResult, ResearchService } from './research.service';

/**
 * The autonomous loop.
 *  - tick() every minute: enqueue due source ingests and, every sweep interval, an AGGREGATE.
 *  - AGGREGATE fans out: SENTIMENT, DEEP_DIVEs for the highest-priority stale opportunities,
 *    POSITION_REVIEWs, and a daily OUTCOME_LABEL pass.
 *  - Two worker lanes (I/O and AI) pull from the Postgres-backed queue so slow scrapes never
 *    block analysis.
 */
@Injectable()
export class OrchestratorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OrchestratorService.name);
  private timers: NodeJS.Timeout[] = [];
  private busy = { io: false, ai: false };
  private stopping = false;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly ingest: IngestService,
    private readonly signals: SignalsService,
    private readonly research: ResearchService,
    private readonly outcomes: OutcomesService,
    private readonly ai: AiService,
  ) {}

  async onApplicationBootstrap() {
    if (process.env.WORKERS_ENABLED === 'false') {
      this.logger.warn('WORKERS_ENABLED=false — background research is off');
      return;
    }
    await this.jobs.recoverStale();
    this.timers.push(setInterval(() => this.tick().catch((e) => this.logger.error(e)), 60_000));
    this.timers.push(setInterval(() => this.drain('io'), 3_000));
    this.timers.push(setInterval(() => this.drain('ai'), 3_000));
    setTimeout(() => this.tick().catch((e) => this.logger.error(e)), 5_000);
  }

  onApplicationShutdown() {
    this.stopping = true;
    this.timers.forEach(clearInterval);
  }

  async nextSweepAt(): Promise<Date | null> {
    const app = await this.settings.getApp();
    if (!app.autonomous) return null;
    const last = await this.jobs.lastCreated('AGGREGATE');
    return new Date((last?.getTime() ?? Date.now()) + app.sweepIntervalMin * 60_000);
  }

  /** Scheduler heartbeat. */
  async tick() {
    const app = await this.settings.getApp();
    if (!app.autonomous) return;
    for (const id of await this.settings.enabledSourceIds()) {
      const s = await this.settings.resolveSource(id);
      const due = !s.lastRunAt || Date.now() - s.lastRunAt.getTime() >= s.intervalMin * 60_000;
      if (due) await this.jobs.enqueue({ type: 'INGEST', target: id, priority: 60, message: 'Scheduled ingest' });
    }
    const next = await this.nextSweepAt();
    if (next && next.getTime() <= Date.now()) {
      await this.jobs.enqueue({ type: 'AGGREGATE', priority: 90, message: 'Scheduled sweep' });
    }
  }

  /** Manual "Run sweep now": ingest everything enabled, then aggregate. */
  async sweepNow() {
    for (const id of await this.settings.enabledSourceIds()) {
      await this.jobs.enqueue({ type: 'INGEST', target: id, priority: 80, message: 'Manual sweep' });
    }
    await this.jobs.enqueue({ type: 'AGGREGATE', priority: 70, runAfter: new Date(Date.now() + 30_000), message: 'Manual sweep' });
  }

  private async drain(lane: 'io' | 'ai') {
    if (this.busy[lane] || this.stopping) return;
    this.busy[lane] = true;
    try {
      for (let i = 0; i < 20 && !this.stopping; i++) {
        const job = await this.jobs.claim(LANES[lane]);
        if (!job) break;
        try {
          const r = await this.handle(job.type as JobType, job.id, job.target, job.payload);
          await this.jobs.complete(job.id, r);
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          const retryable = !(e instanceof BudgetExceededError || e instanceof RoleNotConfiguredError || e instanceof ConfigError);
          this.logger.warn(`${job.type} ${job.target ?? ''} failed: ${msg}`);
          await this.jobs.fail(job, msg, retryable);
        }
      }
    } catch (e: any) {
      this.logger.error(`Worker ${lane}: ${e.message}`);
    } finally {
      this.busy[lane] = false;
    }
  }

  private async handle(type: JobType, jobId: string, target: string | null, payload: Record<string, unknown>): Promise<HandlerResult> {
    switch (type) {
      case 'INGEST':
        return this.ingest.run(target!);
      case 'AGGREGATE': {
        const msg = await this.signals.aggregate();
        const fanned = await this.fanOut();
        return { message: `${msg} · ${fanned}` };
      }
      case 'SENTIMENT':
        return this.research.sentiment(jobId);
      case 'DEEP_DIVE':
        return this.research.deepDive(jobId, target!);
      case 'POSITION_REVIEW':
        return this.research.positionReview(jobId, target!);
      case 'OUTCOME_LABEL':
        return { message: await this.outcomes.label() };
      default:
        throw new Error(`Unknown job type ${type}`);
    }
  }

  /** Decide what the AI should look at after each sweep. */
  private async fanOut(): Promise<string> {
    const app = await this.settings.getApp();
    const parts: string[] = [];

    if (await this.ai.isRoleReady('FAST')) {
      await this.jobs.enqueue({ type: 'SENTIMENT', priority: 55, message: 'Classify new posts' });
      parts.push('sentiment queued');
    }

    if (await this.ai.isRoleReady('ANALYST')) {
      const staleBefore = new Date(Date.now() - app.deepDiveStaleHours * 3_600_000);
      const candidates = await this.db
        .select()
        .from(opportunities)
        .where(
          and(
            eq(opportunities.dismissed, false),
            sql`${opportunities.ticker} NOT IN (SELECT symbol FROM tickers WHERE exchange = 'DEMO')`,
            or(isNull(opportunities.priorityOverride), ne(opportunities.priorityOverride, 'PAUSED')),
            or(ne(opportunities.stage, 'FADING'), eq(opportunities.priorityOverride, 'PINNED')),
            or(
              isNull(opportunities.lastResearchedAt),
              lt(opportunities.nextResearchAt, new Date()),
              lt(opportunities.lastResearchedAt, staleBefore),
            ),
          ),
        )
        .orderBy(desc(opportunities.autoPriority))
        .limit(200);
      const picked = candidates
        .filter((c) => c.priorityOverride === 'PINNED' || inPriceBand(c.price, app))
        .map((c) => ({ c, p: effectivePriority(c.autoPriority, c.priorityOverride) }))
        .sort((a, b) => b.p - a.p)
        .slice(0, app.maxDeepDivesPerSweep);
      for (const { c, p } of picked) {
        await this.jobs.enqueue({
          type: 'DEEP_DIVE',
          target: c.ticker,
          priority: Math.min(p, 100),
          priorityOverride: (c.priorityOverride as any) ?? null,
          message: c.lastResearchedAt ? 'Refresh stale research' : 'New signal',
        });
      }
      parts.push(`${picked.length} deep dives queued`);

      const reviewBefore = new Date(Date.now() - app.positionReviewHours * 3_600_000);
      const due = await this.db
        .select()
        .from(positions)
        .where(
          and(
            isNull(positions.closedAt),
            sql`${positions.ticker} NOT IN (SELECT symbol FROM tickers WHERE exchange = 'DEMO')`,
            or(isNull(positions.lastReviewedAt), lt(positions.lastReviewedAt, reviewBefore)),
          ),
        )
        .orderBy(asc(positions.lastReviewedAt));
      for (const pos of due) {
        await this.jobs.enqueue({ type: 'POSITION_REVIEW', target: pos.id, priority: 85, message: `Review ${pos.ticker}` });
      }
      if (due.length) parts.push(`${due.length} position reviews queued`);
    } else {
      parts.push('analyst model not configured');
    }

    const lastLabel = await this.jobs.lastCreated('OUTCOME_LABEL');
    if (!lastLabel || Date.now() - lastLabel.getTime() > 20 * 3_600_000) {
      await this.jobs.enqueue({ type: 'OUTCOME_LABEL', priority: 10, message: 'Daily outcome labelling' });
    }
    return parts.join(', ');
  }

  // Manual triggers used by controllers
  async researchNow(ticker: string) {
    const opp = await this.db.query.opportunities.findFirst({ where: eq(opportunities.ticker, ticker) });
    return this.jobs.enqueue({
      type: 'DEEP_DIVE',
      target: ticker,
      priority: 95,
      priorityOverride: (opp?.priorityOverride as any) ?? null,
      message: 'Requested by user',
    });
  }

  async reviewNow(positionId: string) {
    return this.jobs.enqueue({ type: 'POSITION_REVIEW', target: positionId, priority: 95, message: 'Requested by user' });
  }

  async ingestNow(sourceId: string) {
    return this.jobs.enqueue({ type: 'INGEST', target: sourceId, priority: 95, message: 'Requested by user' });
  }

  /** Count of opportunities touched by this sweep (for dashboard). */
  async activeCount() {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(opportunities)
      .where(and(eq(opportunities.dismissed, false), ne(opportunities.stage, 'FADING')));
    return r?.n ?? 0;
  }
}
