import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { advice, analyses, filings, newsItems, opportunities, positions, posts, tickerDaily } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { daysAgo, dayKey } from '../common/http';
import { MarketDataService } from '../ingest/market-data.service';
import { TickersService } from '../ingest/tickers.service';
import { SettingsService } from '../settings/settings.service';
import { autoPriority } from '../signals/signals.service';
import { JobsService } from './jobs.service';
import { OutcomesService } from './outcomes.service';
import {
  ANALYST_SYSTEM,
  DeepDiveSchema,
  POSITION_SYSTEM,
  PositionReviewSchema,
  SENTIMENT_SYSTEM,
  SentimentSchema,
} from './prompts';

export interface HandlerResult {
  message: string;
  provider?: string;
  model?: string;
  costUsd?: number;
}

const excerpt = (s: string | null | undefined, n: number) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ai: AiService,
    private readonly jobs: JobsService,
    private readonly settings: SettingsService,
    private readonly market: MarketDataService,
    private readonly tickers: TickersService,
    private readonly outcomes: OutcomesService,
  ) {}

  // ---------------------------------------------------------------- sentiment

  async sentiment(jobId: string): Promise<HandlerResult> {
    const batch = await this.db
      .select()
      .from(posts)
      .where(and(isNull(posts.classifiedAt), sql`jsonb_array_length(${posts.tickers}) > 0`))
      .orderBy(desc(posts.postedAt))
      .limit(150);
    if (!batch.length) return { message: 'Nothing to classify' };
    let cost = 0;
    let provider = '';
    let model = '';
    for (let i = 0; i < batch.length; i += 25) {
      const chunk = batch.slice(i, i + 25);
      await this.jobs.progress(jobId, i / batch.length, `Classifying posts ${i + 1}-${i + chunk.length} of ${batch.length}`);
      const prompt = chunk
        .map(
          (p, idx) =>
            `[${idx}] (${p.channel}, tickers: ${p.tickers.join(',')}, score ${p.score}) ${excerpt(p.title, 200)} ${excerpt(p.body, 600)}`,
        )
        .join('\n');
      const r = await this.ai.json({ role: 'FAST', system: SENTIMENT_SYSTEM, prompt, schema: SentimentSchema, jobId, maxTokens: 3000 });
      cost += r.costUsd;
      provider = r.provider;
      model = r.model;
      for (const item of r.data.items) {
        const p = chunk[item.i];
        if (!p) continue;
        await this.db
          .update(posts)
          .set({ sentiment: p.sentiment ?? item.sentiment, quality: item.quality, classifiedAt: new Date() })
          .where(eq(posts.id, p.id));
      }
      // Anything the model skipped is marked so we don't loop on it forever.
      await this.db
        .update(posts)
        .set({ classifiedAt: new Date() })
        .where(and(isNull(posts.classifiedAt), sql`${posts.id} IN (${sql.join(chunk.map((c) => sql`${c.id}`), sql`, `)})`));
    }
    return { message: `Classified ${batch.length} posts`, provider, model, costUsd: cost };
  }

  // ---------------------------------------------------------------- deep dive

  async deepDive(jobId: string, ticker: string): Promise<HandlerResult> {
    const opp = await this.db.query.opportunities.findFirst({ where: eq(opportunities.ticker, ticker) });
    if (!opp) return { message: `No opportunity for ${ticker}` };
    const info = (await this.tickers.info([ticker])).get(ticker);
    if (info?.exchange === 'DEMO') return { message: `${ticker} is fictional demo data — skipped` };
    const app = await this.settings.getApp();

    await this.jobs.progress(jobId, 0.1, 'Gathering chatter');
    const topPosts = await this.db
      .select()
      .from(posts)
      .where(and(sql`${posts.tickers} ? ${ticker}`, gte(posts.postedAt, daysAgo(14))))
      .orderBy(desc(sql`${posts.score} + ${posts.numComments} * 2`))
      .limit(25);
    const series = await this.db
      .select()
      .from(tickerDaily)
      .where(and(eq(tickerDaily.ticker, ticker), gte(tickerDaily.day, dayKey(daysAgo(30)))))
      .orderBy(asc(tickerDaily.day));

    await this.jobs.progress(jobId, 0.25, 'Pulling news, filings and price');
    const news = await this.db
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.ticker, ticker), gte(newsItems.publishedAt, daysAgo(14))))
      .orderBy(desc(newsItems.publishedAt))
      .limit(15);
    const fil = await this.db
      .select()
      .from(filings)
      .where(and(eq(filings.ticker, ticker), gte(filings.filedAt, daysAgo(90))))
      .orderBy(desc(filings.filedAt))
      .limit(15);
    let quote: { price: number; prevClose: number | null } | null = null;
    try {
      quote = await this.market.quote(ticker);
    } catch (e: any) {
      this.logger.warn(`quote ${ticker}: ${e.message}`);
    }

    let web = '';
    let cost = 0;
    if (await this.ai.isRoleReady('WEB_RESEARCH')) {
      await this.jobs.progress(jobId, 0.4, 'Web research');
      try {
        const w = await this.ai.text({
          role: 'WEB_RESEARCH',
          system: 'You are a financial research assistant. Be factual and cite sources.',
          prompt: `Find the most important recent developments (last 30 days) for ${info?.name ?? ticker} (ticker ${ticker}): catalysts with dates, financing/dilution, analyst or short-seller reports, regulatory events. Bullet points, with dates and sources.`,
          maxTokens: 1500,
          jobId,
        });
        web = w.text;
        cost += w.costUsd;
      } catch (e: any) {
        web = `(web research failed: ${e.message})`;
      }
    }

    const calibration = await this.outcomes.calibrationNotes();
    const prev = opp.thesis
      ? `Previous analysis (${opp.lastResearchedAt?.toISOString()}), score ${opp.score}: ${opp.thesis.summary}`
      : 'No previous analysis.';

    const prompt = `TICKER: ${ticker} — ${info?.name ?? 'unknown name'} (${info?.exchange ?? 'exchange unknown'})
User risk profile: ${app.riskProfile}
Current price: ${quote ? `$${quote.price}${quote.prevClose ? ` (prev close $${quote.prevClose})` : ''}` : 'unavailable'}
Price when first flagged: ${opp.flagPrice ?? 'n/a'} on ${opp.firstFlaggedAt.toISOString().slice(0, 10)}

CHATTER STATS (computed): mentions 24h=${opp.mentions24h}, 7d=${opp.mentions7d}, growth vs 30d baseline=${
      opp.mentionGrowth7d !== null ? `${(opp.mentionGrowth7d * 100).toFixed(0)}%` : 'n/a'
    }, unique authors 7d=${opp.uniqueAuthors7d}, avg sentiment=${opp.sentiment?.toFixed(2) ?? 'n/a'}, saturation=${opp.saturation.toFixed(
      2,
    )}, stage=${opp.stage}

DAILY SERIES (date, mentions, unique authors, close):
${series.map((d) => `${d.day}, ${d.mentions}, ${d.uniqueAuthors}, ${d.close ?? ''}`).join('\n') || 'none'}

TOP POSTS (last 14 days):
${
  topPosts
    .map(
      (p) =>
        `- [${p.channel}, u/${p.author}, score ${p.score}, ${p.numComments} comments, ${p.quality ?? 'unlabelled'}, ${p.postedAt
          .toISOString()
          .slice(0, 10)}] ${excerpt(p.title, 200)} :: ${excerpt(p.body, 700)}`,
    )
    .join('\n') || 'none'
}

NEWS (last 14 days):
${news.map((n) => `- ${n.publishedAt.toISOString().slice(0, 10)} ${n.publisher ?? ''}: ${n.title} — ${excerpt(n.summary, 250)}`).join('\n') || 'none'}

SEC FILINGS (last 90 days):
${fil.map((f) => `- ${f.filedAt.toISOString().slice(0, 10)} ${f.form} ${f.description ?? ''}`).join('\n') || 'none'}

WEB RESEARCH:
${web || 'not configured'}

${prev}

CALIBRATION FROM THIS DATASET'S PAST SIGNALS:
${calibration}

Assess this opportunity and submit your structured answer.`;

    await this.jobs.progress(jobId, 0.6, 'Analyst model reasoning');
    const r = await this.ai.json({ role: 'ANALYST', system: ANALYST_SYSTEM, prompt, schema: DeepDiveSchema, jobId, maxTokens: 4000 });
    cost += r.costUsd;
    const d = r.data;
    const penalizedScore = Math.round(d.score * (1 - 0.5 * d.promotionRisk));

    await this.db.insert(analyses).values({
      ticker,
      opportunityId: opp.id,
      kind: 'DEEP_DIVE',
      provider: r.provider,
      model: r.model,
      score: penalizedScore,
      previousScore: opp.score,
      summary: d.changeSummary,
      output: { ...d, stage: opp.stage },
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: cost,
    });

    const staleH = opp.stage === 'EMERGING' ? app.deepDiveStaleHours / 2 : app.deepDiveStaleHours;
    const strength = Math.min(100, (opp.mentionGrowth7d ?? 0) * 20 + Math.log10(opp.mentions7d + 1) * 12);
    await this.db
      .update(opportunities)
      .set({
        score: penalizedScore,
        breakdown: d.breakdown,
        thesis: d.thesis,
        themes: d.themes,
        lastResearchedAt: new Date(),
        nextResearchAt: new Date(Date.now() + staleH * 3_600_000),
        price: quote?.price ?? opp.price,
        change1d: quote?.prevClose ? quote.price / quote.prevClose - 1 : opp.change1d,
        flagPrice: opp.flagPrice ?? quote?.price ?? null,
        autoPriority: autoPriority(strength, penalizedScore, opp.saturation, opp.stage as any),
        updatedAt: new Date(),
      })
      .where(eq(opportunities.id, opp.id));

    return {
      message: `${ticker} scored ${opp.score !== null ? `${Math.round(opp.score)} → ` : ''}${penalizedScore}: ${d.changeSummary}`,
      provider: r.provider,
      model: r.model,
      costUsd: cost,
    };
  }

  // ---------------------------------------------------------------- position review

  async positionReview(jobId: string, positionId: string): Promise<HandlerResult> {
    const pos = await this.db.query.positions.findFirst({ where: eq(positions.id, positionId) });
    if (!pos || pos.closedAt) return { message: 'Position closed or missing' };
    if ((await this.tickers.info([pos.ticker])).get(pos.ticker)?.exchange === 'DEMO') {
      return { message: `${pos.ticker} is fictional demo data — skipped` };
    }
    const app = await this.settings.getApp();
    const opp = await this.db.query.opportunities.findFirst({ where: eq(opportunities.ticker, pos.ticker) });
    let quote: { price: number; prevClose: number | null } | null = null;
    try {
      quote = await this.market.quote(pos.ticker);
    } catch {
      /* fall back to cached */
    }
    const price = quote?.price ?? opp?.price ?? null;
    const series = await this.db
      .select()
      .from(tickerDaily)
      .where(and(eq(tickerDaily.ticker, pos.ticker), gte(tickerDaily.day, dayKey(daysAgo(21)))))
      .orderBy(asc(tickerDaily.day));
    const news = await this.db
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.ticker, pos.ticker), gte(newsItems.publishedAt, daysAgo(10))))
      .orderBy(desc(newsItems.publishedAt))
      .limit(10);
    const fil = await this.db
      .select()
      .from(filings)
      .where(and(eq(filings.ticker, pos.ticker), gte(filings.filedAt, daysAgo(30))))
      .orderBy(desc(filings.filedAt))
      .limit(10);
    const lastAdvice = await this.db.query.advice.findFirst({
      where: eq(advice.positionId, pos.id),
      orderBy: desc(advice.createdAt),
    });

    const pnlPct = price ? price / pos.entryPrice - 1 : null;
    const prompt = `POSITION: ${pos.quantity} shares of ${pos.ticker} bought at $${pos.entryPrice} on ${pos.entryDate}.
Current price: ${price ?? 'unknown'}; P/L: ${pnlPct !== null ? `${(pnlPct * 100).toFixed(1)}%` : 'unknown'}.
User notes: ${pos.notes ?? 'none'}. Risk profile: ${app.riskProfile}.

CURRENT THESIS: ${opp?.thesis ? JSON.stringify(opp.thesis) : 'none on file'}
Chatter stage: ${opp?.stage ?? 'n/a'}, saturation ${opp?.saturation?.toFixed(2) ?? 'n/a'}, mentions 24h ${opp?.mentions24h ?? 'n/a'}, 7d ${
      opp?.mentions7d ?? 'n/a'
    }, sentiment ${opp?.sentiment?.toFixed(2) ?? 'n/a'}, AI score ${opp?.score ?? 'n/a'}.

DAILY (date, mentions, authors, close):
${series.map((d) => `${d.day}, ${d.mentions}, ${d.uniqueAuthors}, ${d.close ?? ''}`).join('\n') || 'none'}

NEWS: ${news.map((n) => `\n- ${n.publishedAt.toISOString().slice(0, 10)} ${n.title}`).join('') || 'none'}
FILINGS: ${fil.map((f) => `\n- ${f.filedAt.toISOString().slice(0, 10)} ${f.form} ${f.description ?? ''}`).join('') || 'none'}
PREVIOUS ADVICE: ${lastAdvice ? `${lastAdvice.action} (${lastAdvice.createdAt.toISOString().slice(0, 10)}): ${lastAdvice.rationale}` : 'none'}`;

    const r = await this.ai.json({ role: 'ANALYST', system: POSITION_SYSTEM, prompt, schema: PositionReviewSchema, jobId, maxTokens: 1500 });
    const [a] = await this.db
      .insert(analyses)
      .values({
        ticker: pos.ticker,
        opportunityId: opp?.id ?? null,
        positionId: pos.id,
        kind: 'POSITION_REVIEW',
        provider: r.provider,
        model: r.model,
        score: null,
        summary: `${r.data.action}: ${r.data.rationale}`,
        output: r.data,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUsd: r.costUsd,
      })
      .returning();
    await this.db.insert(advice).values({
      positionId: pos.id,
      action: r.data.action,
      confidence: r.data.confidence,
      rationale: r.data.rationale,
      stopLoss: r.data.stopLoss,
      takeProfit: r.data.takeProfit,
      analysisId: a.id,
    });
    await this.db.update(positions).set({ lastReviewedAt: new Date() }).where(eq(positions.id, pos.id));
    return { message: `${pos.ticker}: ${r.data.action} (${Math.round(r.data.confidence * 100)}% confidence)`, provider: r.provider, model: r.model, costUsd: r.costUsd };
  }
}
