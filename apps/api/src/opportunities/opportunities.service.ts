import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, sql } from 'drizzle-orm';
import {
  AnalysisDto,
  DailyPoint,
  JobType,
  OpportunityDetail,
  OpportunityListItem,
  Priority,
  SourceItemDto,
  Stage,
} from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { analyses, filings, newsItems, opportunities, positions, posts, tickerDaily } from '../db/schema';
import { dayKey, daysAgo } from '../common/http';
import { TickersService } from '../ingest/tickers.service';
import { effectivePriority } from '../signals/signals.service';

type OppRow = typeof opportunities.$inferSelect;

const QUALITY_TAG: Record<string, string> = {
  DD: 'High-effort DD',
  HYPE: 'Hype',
  NEWS: 'News share',
  QUESTION: 'Question',
  PROMO: 'Possible promo',
};

const FORM_TAG: Record<string, string> = {
  '4': 'Insider trade',
  '8-K': 'Material event',
  '10-Q': 'Quarterly report',
  '10-K': 'Annual report',
  'S-1': 'Registration',
  'SC 13D': 'Activist stake',
  'SC 13G': 'Large holder',
};

@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tickers: TickersService,
  ) {}

  async list(o: { stage?: Stage; q?: string; includeDismissed?: boolean; limit?: number }): Promise<OpportunityListItem[]> {
    const where = and(
      o.includeDismissed ? undefined : eq(opportunities.dismissed, false),
      o.stage ? eq(opportunities.stage, o.stage) : undefined,
      o.q ? ilike(opportunities.ticker, `${o.q.toUpperCase()}%`) : undefined,
    );
    const rows = await this.db.select().from(opportunities).where(where).orderBy(desc(opportunities.autoPriority)).limit(500);
    const items = await this.toListItems(rows);
    return items
      .sort((a, b) => b.effectivePriority - a.effectivePriority || (b.score ?? 0) - (a.score ?? 0))
      .slice(0, o.limit ?? 200);
  }

  async detail(ticker: string): Promise<OpportunityDetail> {
    const opp = await this.db.query.opportunities.findFirst({ where: eq(opportunities.ticker, ticker.toUpperCase()) });
    if (!opp) throw new NotFoundException(`${ticker} is not being tracked`);
    const [base] = await this.toListItems([opp]);
    const t = opp.ticker;

    const daily = await this.db
      .select()
      .from(tickerDaily)
      .where(and(eq(tickerDaily.ticker, t), gte(tickerDaily.day, dayKey(daysAgo(90)))))
      .orderBy(asc(tickerDaily.day));
    const byDay = new Map(daily.map((d) => [d.day, d]));
    const series: DailyPoint[] = [];
    for (let i = 89; i >= 0; i--) {
      const k = dayKey(daysAgo(i));
      const d = byDay.get(k);
      series.push({ date: k, close: d?.close ?? null, mentions: d?.mentions ?? 0 });
    }

    const [topPosts, news, fil, hist] = await Promise.all([
      this.db
        .select()
        .from(posts)
        .where(and(sql`${posts.tickers} ? ${t}`, eq(posts.isComment, false), gte(posts.postedAt, daysAgo(14))))
        .orderBy(desc(sql`${posts.score} + ${posts.numComments} * 2`))
        .limit(10),
      this.db.select().from(newsItems).where(eq(newsItems.ticker, t)).orderBy(desc(newsItems.publishedAt)).limit(8),
      this.db.select().from(filings).where(eq(filings.ticker, t)).orderBy(desc(filings.filedAt)).limit(8),
      this.db.select().from(analyses).where(eq(analyses.ticker, t)).orderBy(desc(analyses.createdAt)).limit(15),
    ]);

    const sources: SourceItemDto[] = [
      ...topPosts.map((p) => ({
        id: p.id,
        kind: 'POST' as const,
        source: p.channel,
        title: p.title ?? (p.body ?? '').slice(0, 140),
        url: p.url,
        publishedAt: p.postedAt.toISOString(),
        meta: `${p.score.toLocaleString()} upvotes · ${p.numComments.toLocaleString()} comments${p.author ? ` · u/${p.author}` : ''}`,
        tag: p.quality ? (QUALITY_TAG[p.quality] ?? null) : null,
      })),
      ...fil.map((f) => ({
        id: f.id,
        kind: 'FILING' as const,
        source: 'SEC EDGAR',
        title: `Form ${f.form}${f.description ? `: ${f.description}` : ''}`,
        url: f.url,
        publishedAt: f.filedAt.toISOString(),
        meta: `Accession ${f.accession}`,
        tag: FORM_TAG[f.form] ?? 'Filing',
      })),
      ...news.map((n) => ({
        id: n.id,
        kind: 'NEWS' as const,
        source: n.publisher ?? 'News',
        title: n.title,
        url: n.url,
        publishedAt: n.publishedAt.toISOString(),
        meta: (n.summary ?? '').slice(0, 140),
        tag: 'News',
      })),
    ].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    const history: AnalysisDto[] = hist.map((a) => ({
      id: a.id,
      createdAt: a.createdAt.toISOString(),
      kind: a.kind as JobType,
      provider: a.provider,
      model: a.model,
      score: a.score,
      previousScore: a.previousScore,
      summary: a.summary,
    }));

    const info = (await this.tickers.info([t])).get(t);
    return {
      ...base,
      breakdown: opp.breakdown ?? null,
      thesis: opp.thesis ?? null,
      series,
      sources,
      history,
      nextResearchAt: opp.nextResearchAt?.toISOString() ?? null,
      exchange: info?.exchange ?? null,
      sector: info?.sector ?? null,
    };
  }

  async setPriority(ticker: string, priority: Priority) {
    const [row] = await this.db
      .update(opportunities)
      .set({ priorityOverride: priority === 'AUTO' ? null : priority, updatedAt: new Date() })
      .where(eq(opportunities.ticker, ticker.toUpperCase()))
      .returning();
    if (!row) throw new NotFoundException();
    return (await this.toListItems([row]))[0];
  }

  async patch(ticker: string, body: { watch?: boolean; dismissed?: boolean }) {
    const [row] = await this.db
      .update(opportunities)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(opportunities.ticker, ticker.toUpperCase()))
      .returning();
    if (!row) throw new NotFoundException();
    return (await this.toListItems([row]))[0];
  }

  /** Start tracking a ticker manually (e.g. something you heard about elsewhere). */
  async track(ticker: string, priority: Priority = 'HIGH'): Promise<OppRow> {
    const t = ticker.toUpperCase().trim();
    const valid = await this.tickers.validSet();
    if (valid.size && !valid.has(t)) throw new NotFoundException(`${t} is not a known US-listed ticker`);
    await this.db
      .insert(opportunities)
      .values({ ticker: t, priorityOverride: priority === 'AUTO' ? null : priority, autoPriority: 50 })
      .onConflictDoUpdate({ target: opportunities.ticker, set: { dismissed: false } });
    return (await this.db.query.opportunities.findFirst({ where: eq(opportunities.ticker, t) }))!;
  }

  async toListItems(rows: OppRow[]): Promise<OpportunityListItem[]> {
    if (!rows.length) return [];
    const tick = rows.map((r) => r.ticker);
    const [spark, held, info] = await Promise.all([
      this.db
        .select({ ticker: tickerDaily.ticker, day: tickerDaily.day, mentions: tickerDaily.mentions })
        .from(tickerDaily)
        .where(and(inArray(tickerDaily.ticker, tick), gte(tickerDaily.day, dayKey(daysAgo(13)))))
        .orderBy(asc(tickerDaily.day)),
      this.db
        .select({ t: positions.ticker })
        .from(positions)
        .where(and(inArray(positions.ticker, tick), isNull(positions.closedAt))),
      this.tickers.info(tick),
    ]);
    const heldSet = new Set(held.map((h) => h.t));
    const days = Array.from({ length: 14 }, (_, i) => dayKey(daysAgo(13 - i)));
    const sparkMap = new Map<string, Map<string, number>>();
    for (const s of spark) {
      if (!sparkMap.has(s.ticker)) sparkMap.set(s.ticker, new Map());
      sparkMap.get(s.ticker)!.set(s.day, s.mentions);
    }
    return rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      name: info.get(r.ticker)?.name ?? null,
      score: r.score !== null ? Math.round(r.score) : null,
      stage: r.stage as Stage,
      saturation: r.saturation,
      mentions24h: r.mentions24h,
      mentions7d: r.mentions7d,
      mentionGrowth7d: r.mentionGrowth7d,
      uniqueAuthors7d: r.uniqueAuthors7d,
      sentiment: r.sentiment,
      sparkline: days.map((d) => sparkMap.get(r.ticker)?.get(d) ?? 0),
      price: r.price,
      change1d: r.change1d,
      lastResearchedAt: r.lastResearchedAt?.toISOString() ?? null,
      firstFlaggedAt: r.firstFlaggedAt.toISOString(),
      priority: (r.priorityOverride as Priority) ?? 'AUTO',
      effectivePriority: effectivePriority(r.autoPriority, r.priorityOverride),
      isHeld: heldSet.has(r.ticker),
      watch: r.watch,
    }));
  }
}

