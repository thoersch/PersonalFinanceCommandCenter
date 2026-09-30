import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { analyses, opportunities, outcomes, tickerDaily } from '../db/schema';
import { dayKey, daysAgo } from '../common/http';

export const HORIZONS = [7, 14, 30];

/**
 * The learning loop: record what each flagged signal actually did afterwards, then feed
 * those stats back into the analyst prompt so scoring calibrates to this dataset over time.
 */
@Injectable()
export class OutcomesService {
  constructor(@InjectDb() private readonly db: Db) {}

  async label(): Promise<string> {
    const opps = await this.db.select().from(opportunities).where(isNotNull(opportunities.flagPrice));
    let n = 0;
    for (const o of opps) {
      for (const h of HORIZONS) {
        const target = new Date(o.firstFlaggedAt.getTime() + h * 86_400_000);
        if (target > new Date()) continue;
        const [bar] = await this.db
          .select()
          .from(tickerDaily)
          .where(and(eq(tickerDaily.ticker, o.ticker), gte(tickerDaily.day, dayKey(target)), isNotNull(tickerDaily.close)))
          .orderBy(asc(tickerDaily.day))
          .limit(1);
        if (!bar?.close || !o.flagPrice) continue;
        const [first] = await this.db
          .select()
          .from(analyses)
          .where(and(eq(analyses.ticker, o.ticker), eq(analyses.kind, 'DEEP_DIVE')))
          .orderBy(asc(analyses.createdAt))
          .limit(1);
        const ins = await this.db
          .insert(outcomes)
          .values({
            opportunityId: o.id,
            ticker: o.ticker,
            horizonDays: h,
            flaggedAt: o.firstFlaggedAt,
            flagPrice: o.flagPrice,
            scoreAtFlag: first?.score ?? null,
            stageAtFlag: (first?.output as any)?.stage ?? o.stage,
            breakdownAtFlag: (first?.output as any)?.breakdown ?? null,
            priceAfter: bar.close,
            returnPct: bar.close / o.flagPrice - 1,
          })
          .onConflictDoNothing()
          .returning({ id: outcomes.id });
        n += ins.length;
      }
    }
    return `${n} new outcome labels`;
  }

  /** Short text block injected into analyst prompts. */
  async calibrationNotes(): Promise<string> {
    const res = await this.db.execute(sql`
      SELECT
        CASE WHEN score_at_flag >= 80 THEN '80+' WHEN score_at_flag >= 65 THEN '65-79' WHEN score_at_flag IS NULL THEN 'unscored' ELSE '<65' END AS bucket,
        stage_at_flag AS stage,
        count(*)::int AS n,
        avg(CASE WHEN return_pct > 0 THEN 1 ELSE 0 END)::float AS hit,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY return_pct)::float AS median
      FROM outcomes WHERE horizon_days = 14
      GROUP BY 1, 2 HAVING count(*) >= 3 ORDER BY 1, 2`);
    const rows = res.rows as any[];
    if (!rows.length) return 'No labelled outcomes yet — the internal dataset is still warming up.';
    return rows
      .map(
        (r) =>
          `score ${r.bucket}, stage ${r.stage}: n=${r.n}, 14-day hit rate ${(r.hit * 100).toFixed(0)}%, median return ${(r.median * 100).toFixed(1)}%`,
      )
      .join('\n');
  }

  async hitRate30d(): Promise<number | null> {
    const [row] = await this.db
      .select({
        n: sql<number>`count(*)::int`,
        hit: sql<number>`avg(CASE WHEN ${outcomes.returnPct} > 0 THEN 1 ELSE 0 END)::float`,
      })
      .from(outcomes)
      .where(and(eq(outcomes.horizonDays, 14), gte(outcomes.labeledAt, daysAgo(30))));
    return row && row.n > 0 ? row.hit : null;
  }
}
