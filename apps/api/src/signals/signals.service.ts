import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { Priority, Stage } from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { opportunities } from '../db/schema';
import { SettingsService } from '../settings/settings.service';

export interface TickerStats {
  ticker: string;
  m24: number;
  m7: number;
  authors7: number;
  channels7: number;
  baselineWeekly: number;
  sentiment: number | null;
  newsCount7: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** Pure scoring helpers — exported for unit tests. */
export function computeSignal(s: TickerStats, daysSinceFlag: number) {
  const growth = (s.m7 - s.baselineWeekly) / Math.max(s.baselineWeekly, 1);
  const accel = s.m7 > 0 ? (s.m24 * 7) / s.m7 : 0; // >1 = today is busier than the weekly average
  // How "discovered" is this? Many distinct authors, many communities, press coverage, time.
  const saturation = clamp(
    0.45 * clamp(Math.log10(s.authors7 + 1) / Math.log10(1500)) +
      0.25 * clamp((s.channels7 - 1) / 6) +
      0.15 * clamp(s.newsCount7 / 15) +
      0.15 * clamp(daysSinceFlag / 30),
  );
  let stage: Stage;
  if (growth < -0.3 || (accel < 0.5 && growth < 0.5)) stage = 'FADING';
  else if (saturation >= 0.65) stage = 'CROWDED';
  else if (saturation < 0.4 && accel >= 0.9) stage = 'EMERGING';
  else stage = 'ACCELERATING';
  const strength = clamp((25 * Math.log2(1 + Math.max(growth, 0)) + 12 * Math.log10(s.m7 + 1)) / 100) * 100;
  return { growth, accel, saturation, stage, strength };
}

export function autoPriority(strength: number, score: number | null, saturation: number, stage: Stage) {
  const base = 0.5 * (score ?? strength) + 0.3 * strength + 20 * (1 - saturation);
  return stage === 'FADING' ? base * 0.5 : base;
}

/** True when the price is inside the user's share-price band. Unknown prices pass — we can't judge them yet. */
export function inPriceBand(price: number | null, band: { minSharePrice: number | null; maxSharePrice: number | null }) {
  if (price === null) return true;
  if (band.minSharePrice !== null && price < band.minSharePrice) return false;
  if (band.maxSharePrice !== null && price > band.maxSharePrice) return false;
  return true;
}

export function effectivePriority(auto: number, override: Priority | null | string): number {
  switch (override) {
    case 'PINNED':
      return 1000 + auto;
    case 'HIGH':
      return auto + 50;
    case 'LOW':
      return auto - 50;
    case 'PAUSED':
      return -1000;
    default:
      return auto;
  }
}

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  /** Rolls mentions into the daily dataset and refreshes every opportunity's stats and stage. */
  async aggregate(): Promise<string> {
    await this.db.execute(sql`
      INSERT INTO ticker_daily (ticker, day, mentions, unique_authors, avg_sentiment)
      SELECT m.ticker, (m.posted_at AT TIME ZONE 'UTC')::date, count(*)::int, count(DISTINCT m.author)::int, avg(p.sentiment)
      FROM mentions m JOIN posts p ON p.id = m.post_id
      WHERE m.posted_at >= now() - interval '3 days'
      GROUP BY 1, 2
      ON CONFLICT (ticker, day) DO UPDATE
        SET mentions = excluded.mentions, unique_authors = excluded.unique_authors, avg_sentiment = excluded.avg_sentiment`);

    const res = await this.db.execute(sql`
      WITH w AS (
        SELECT m.ticker,
          count(*) FILTER (WHERE m.posted_at >= now() - interval '24 hours')::int AS m24,
          count(*) FILTER (WHERE m.posted_at >= now() - interval '7 days')::int AS m7,
          count(DISTINCT m.author) FILTER (WHERE m.posted_at >= now() - interval '7 days')::int AS authors7,
          count(DISTINCT m.channel) FILTER (WHERE m.posted_at >= now() - interval '7 days')::int AS channels7,
          (count(*) FILTER (WHERE m.posted_at < now() - interval '7 days'))::float / 30 * 7 AS baseline_weekly,
          avg(p.sentiment) FILTER (WHERE m.posted_at >= now() - interval '7 days') AS sentiment
        FROM mentions m JOIN posts p ON p.id = m.post_id
        WHERE m.posted_at >= now() - interval '37 days'
        GROUP BY m.ticker
      )
      SELECT w.*, coalesce(n.cnt, 0)::int AS news7
      FROM w LEFT JOIN (
        SELECT ticker, count(*) AS cnt FROM news_items WHERE published_at >= now() - interval '7 days' GROUP BY ticker
      ) n ON n.ticker = w.ticker`);

    const app = await this.settings.getApp();
    const existing = new Map((await this.db.select().from(opportunities)).map((o) => [o.ticker, o]));
    let created = 0;
    let updated = 0;
    for (const r of res.rows as any[]) {
      const stats: TickerStats = {
        ticker: r.ticker,
        m24: r.m24,
        m7: r.m7,
        authors7: r.authors7,
        channels7: r.channels7,
        baselineWeekly: Number(r.baseline_weekly) || 0,
        sentiment: r.sentiment === null ? null : Number(r.sentiment),
        newsCount7: r.news7,
      };
      const opp = existing.get(stats.ticker);
      if (!opp && stats.m7 < app.minMentionsForSignal) continue;
      const daysSinceFlag = opp ? (Date.now() - opp.firstFlaggedAt.getTime()) / 86_400_000 : 0;
      const sig = computeSignal(stats, daysSinceFlag);
      const values = {
        stage: sig.stage,
        saturation: sig.saturation,
        mentions24h: stats.m24,
        mentions7d: stats.m7,
        mentionGrowth7d: sig.growth,
        uniqueAuthors7d: stats.authors7,
        sentiment: stats.sentiment,
        autoPriority: autoPriority(sig.strength, opp?.score ?? null, sig.saturation, sig.stage),
        updatedAt: new Date(),
      };
      if (opp) {
        await this.db.update(opportunities).set(values).where(eq(opportunities.id, opp.id));
        updated++;
      } else {
        await this.db.insert(opportunities).values({ ticker: stats.ticker, ...values }).onConflictDoNothing();
        created++;
      }
    }
    // Opportunities with no chatter in the window at all have faded.
    await this.db.execute(sql`
      UPDATE opportunities SET stage = 'FADING', mentions_24h = 0, mentions_7d = 0, auto_priority = auto_priority * 0.5
      WHERE ticker NOT IN (SELECT DISTINCT ticker FROM mentions WHERE posted_at >= now() - interval '7 days')
        AND stage <> 'FADING'`);
    const msg = `${created} new signals, ${updated} refreshed`;
    this.logger.log(msg);
    return msg;
  }
}
