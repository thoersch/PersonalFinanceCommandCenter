import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { JobStatus, JobType, Priority, ResearchJobDto } from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { jobs } from '../db/schema';

type JobRow = typeof jobs.$inferSelect;

/** Effective ordering: user overrides beat the automatic priority. Mirrors signals.effectivePriority. */
const EFFECTIVE = sql`CASE ${jobs.priorityOverride}
  WHEN 'PINNED' THEN 1000 + ${jobs.priority}
  WHEN 'HIGH' THEN ${jobs.priority} + 50
  WHEN 'LOW' THEN ${jobs.priority} - 50
  ELSE ${jobs.priority} END`;

export const LANES: Record<'io' | 'ai', JobType[]> = {
  io: ['INGEST', 'AGGREGATE', 'OUTCOME_LABEL'],
  ai: ['SENTIMENT', 'DEEP_DIVE', 'POSITION_REVIEW'],
};

@Injectable()
export class JobsService {
  constructor(@InjectDb() private readonly db: Db) {}

  async enqueue(o: {
    type: JobType;
    target?: string | null;
    priority?: number;
    priorityOverride?: Priority | null;
    payload?: Record<string, unknown>;
    runAfter?: Date;
    message?: string;
  }): Promise<JobRow> {
    // One live job per (type, target): re-queuing just bumps its priority.
    const live = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, o.type),
          o.target ? eq(jobs.target, o.target) : sql`${jobs.target} IS NULL`,
          inArray(jobs.status, ['QUEUED', 'RUNNING']),
        ),
      )
      .limit(1);
    if (live[0]) {
      if (live[0].status === 'QUEUED' && ((o.priority ?? 0) > live[0].priority || o.priorityOverride)) {
        const [u] = await this.db
          .update(jobs)
          .set({
            priority: Math.max(o.priority ?? 0, live[0].priority),
            ...(o.priorityOverride ? { priorityOverride: o.priorityOverride } : {}),
            ...(o.runAfter ? {} : { runAfter: new Date() }),
          })
          .where(eq(jobs.id, live[0].id))
          .returning();
        return u;
      }
      return live[0];
    }
    const [row] = await this.db
      .insert(jobs)
      .values({
        type: o.type,
        target: o.target ?? null,
        priority: o.priority ?? 0,
        priorityOverride: o.priorityOverride ?? null,
        payload: o.payload ?? {},
        runAfter: o.runAfter ?? new Date(),
        message: o.message ?? 'Queued',
      })
      .returning();
    return row;
  }

  /** Atomically claims the next runnable job in a lane (safe with multiple API replicas). */
  async claim(types: JobType[]): Promise<JobRow | null> {
    const res = await this.db.execute(sql`
      UPDATE jobs SET status = 'RUNNING', started_at = now(), attempts = attempts + 1, progress = 0, message = 'Starting'
      WHERE id = (
        SELECT id FROM jobs
        WHERE status = 'QUEUED' AND run_after <= now()
          AND coalesce(priority_override, '') <> 'PAUSED'
          AND type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
        ORDER BY ${EFFECTIVE} DESC, created_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING id`);
    const id = (res.rows[0] as any)?.id;
    if (!id) return null;
    return (await this.db.query.jobs.findFirst({ where: eq(jobs.id, id) })) ?? null;
  }

  async progress(id: string, progress: number, message: string) {
    await this.db.update(jobs).set({ progress, message }).where(eq(jobs.id, id));
  }

  async complete(id: string, r: { message: string; provider?: string; model?: string; costUsd?: number }) {
    await this.db
      .update(jobs)
      .set({
        status: 'DONE',
        progress: 1,
        message: r.message.slice(0, 500),
        provider: r.provider ?? null,
        model: r.model ?? null,
        costUsd: r.costUsd ?? null,
        finishedAt: new Date(),
      })
      .where(eq(jobs.id, id));
  }

  async fail(job: JobRow, error: string, retryable: boolean) {
    const retry = retryable && job.attempts < 3;
    await this.db
      .update(jobs)
      .set(
        retry
          ? {
              status: 'QUEUED',
              error: error.slice(0, 1000),
              message: `Retrying after error (attempt ${job.attempts}/3)`,
              runAfter: new Date(Date.now() + 2 ** job.attempts * 60_000),
            }
          : { status: 'FAILED', error: error.slice(0, 1000), message: error.slice(0, 300), finishedAt: new Date() },
      )
      .where(eq(jobs.id, job.id));
  }

  /** Jobs orphaned by a restart go back to the queue. */
  async recoverStale() {
    await this.db
      .update(jobs)
      .set({ status: 'QUEUED', message: 'Re-queued after restart' })
      .where(and(eq(jobs.status, 'RUNNING'), sql`${jobs.startedAt} < now() - interval '15 minutes'`));
  }

  async list(status?: JobStatus[], limit = 100): Promise<ResearchJobDto[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(status?.length ? inArray(jobs.status, status) : undefined)
      .orderBy(
        status?.every((s) => s === 'QUEUED') ? sql`${EFFECTIVE} DESC` : desc(sql`coalesce(${jobs.finishedAt}, ${jobs.startedAt}, ${jobs.createdAt})`),
      )
      .limit(limit);
    return rows.map(toDto);
  }

  async counts() {
    const rows = await this.db
      .select({ status: jobs.status, n: sql<number>`count(*)::int` })
      .from(jobs)
      .where(inArray(jobs.status, ['QUEUED', 'RUNNING']))
      .groupBy(jobs.status);
    return {
      running: rows.find((r) => r.status === 'RUNNING')?.n ?? 0,
      queued: rows.find((r) => r.status === 'QUEUED')?.n ?? 0,
    };
  }

  async setOverride(id: string, override: Priority | null) {
    const [row] = await this.db
      .update(jobs)
      .set({ priorityOverride: override === 'AUTO' ? null : override })
      .where(eq(jobs.id, id))
      .returning();
    if (!row) throw new NotFoundException();
    return toDto(row);
  }

  async cancel(id: string) {
    const [row] = await this.db
      .update(jobs)
      .set({ status: 'CANCELLED', finishedAt: new Date(), message: 'Cancelled by user' })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'QUEUED')))
      .returning();
    if (!row) throw new NotFoundException('Only queued jobs can be cancelled');
    return toDto(row);
  }

  async retry(id: string) {
    const [row] = await this.db
      .update(jobs)
      .set({ status: 'QUEUED', attempts: 0, error: null, runAfter: new Date(), message: 'Re-queued by user' })
      .where(and(eq(jobs.id, id), inArray(jobs.status, ['FAILED', 'CANCELLED'])))
      .returning();
    if (!row) throw new NotFoundException('Only failed or cancelled jobs can be retried');
    return toDto(row);
  }

  async lastFinished(type: JobType): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: jobs.finishedAt })
      .from(jobs)
      .where(and(eq(jobs.type, type), eq(jobs.status, 'DONE')))
      .orderBy(desc(jobs.finishedAt))
      .limit(1);
    return row?.at ?? null;
  }

  async lastCreated(type: JobType): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.type, type))
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return row?.at ?? null;
  }
}

export function toDto(r: JobRow): ResearchJobDto {
  return {
    id: r.id,
    type: r.type as JobType,
    status: r.status as JobStatus,
    target: r.target,
    priority: Math.round(r.priority),
    priorityOverride: (r.priorityOverride as Priority) ?? null,
    progress: r.progress,
    message: r.message,
    provider: r.provider,
    model: r.model,
    costUsd: r.costUsd,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    runAfter: r.runAfter.toISOString(),
    error: r.error,
  };
}
