import { Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { opportunities, tickerDaily } from '../db/schema';
import { ConfigError, dayKey, daysAgo, fetchJson, sleep } from '../common/http';
import { ResolvedSource, SettingsService } from '../settings/settings.service';
import { TickersService } from './tickers.service';
import { RunResult } from './social.sources';

export interface Bar {
  date: string;
  close: number;
  volume: number | null;
}
export interface Quote {
  price: number;
  prevClose: number | null;
}

/**
 * Wraps whichever market-data sources the user enabled. Daily bars prefer Polygon, then
 * Alpha Vantage; quotes prefer Finnhub, then Polygon, then Alpha Vantage.
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly tickers: TickersService,
  ) {}

  private async enabled(): Promise<Map<string, ResolvedSource>> {
    const ids = await this.settings.enabledSourceIds('MARKET');
    const out = new Map<string, ResolvedSource>();
    for (const id of ids) {
      const s = await this.settings.resolveSource(id);
      if (s.credentials.apiKey) out.set(id, s);
    }
    return out;
  }

  async isAvailable() {
    return (await this.enabled()).size > 0;
  }

  async daily(ticker: string, days = 90): Promise<Bar[]> {
    const src = await this.enabled();
    const polygon = src.get('polygon');
    if (polygon) {
      const base = String(polygon.options.baseUrl ?? 'https://api.polygon.io');
      const res = await fetchJson<any>(
        `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${dayKey(daysAgo(days))}/${dayKey(new Date())}?adjusted=true&sort=asc&limit=5000&apiKey=${polygon.credentials.apiKey}`,
      );
      return (res.results ?? []).map((r: any) => ({ date: dayKey(new Date(r.t)), close: r.c, volume: r.v ?? null }));
    }
    const av = src.get('alphavantage');
    if (av) {
      const res = await fetchJson<any>(
        `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(ticker)}&outputsize=compact&apikey=${av.credentials.apiKey}`,
      );
      const series = res['Time Series (Daily)'] ?? {};
      return Object.entries(series)
        .map(([date, v]: [string, any]) => ({ date, close: Number(v['4. close']), volume: Number(v['5. volume']) }))
        .filter((b) => b.date >= dayKey(daysAgo(days)))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
    const q = await this.quote(ticker);
    return q ? [{ date: dayKey(new Date()), close: q.price, volume: null }] : [];
  }

  async quote(ticker: string): Promise<Quote | null> {
    const src = await this.enabled();
    const fh = src.get('finnhub');
    if (fh) {
      const r = await fetchJson<any>(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${fh.credentials.apiKey}`);
      if (r && r.c) return { price: r.c, prevClose: r.pc || null };
    }
    const polygon = src.get('polygon');
    if (polygon) {
      const base = String(polygon.options.baseUrl ?? 'https://api.polygon.io');
      const bars = await fetchJson<any>(
        `${base}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${dayKey(daysAgo(7))}/${dayKey(new Date())}?adjusted=true&sort=desc&limit=2&apiKey=${polygon.credentials.apiKey}`,
      );
      const [last, prev] = bars.results ?? [];
      if (last) return { price: last.c, prevClose: prev?.c ?? null };
    }
    const av = src.get('alphavantage');
    if (av) {
      const r = await fetchJson<any>(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${av.credentials.apiKey}`,
      );
      const g = r['Global Quote'];
      if (g?.['05. price']) return { price: Number(g['05. price']), prevClose: Number(g['08. previous close']) || null };
    }
    return null;
  }

  /** Scheduled sync: quotes + daily closes for tracked tickers, written into the internal dataset. */
  async sync(sourceId: string): Promise<RunResult> {
    const src = await this.enabled();
    if (!src.has(sourceId)) throw new ConfigError('Add an API key to enable this market data source');
    // Only the highest-preference enabled source does the work; the others no-op to save quota.
    const leader = ['polygon', 'finnhub', 'alphavantage'].find((id) => src.has(id));
    if (leader !== sourceId) return { message: `Standing by — ${leader} is the active market data source` };

    const symbols = await this.tickers.tracked(sourceId === 'alphavantage' ? 5 : 30);
    let updated = 0;
    for (const t of symbols) {
      try {
        const bars = await this.daily(t, 45);
        for (const b of bars) {
          await this.db
            .insert(tickerDaily)
            .values({ ticker: t, day: b.date, close: b.close, volume: b.volume })
            .onConflictDoUpdate({
              target: [tickerDaily.ticker, tickerDaily.day],
              set: { close: sql`excluded.close`, volume: sql`excluded.volume` },
            });
        }
        const q = await this.quote(t);
        if (q) {
          await this.db
            .update(opportunities)
            .set({
              price: q.price,
              change1d: q.prevClose ? q.price / q.prevClose - 1 : null,
              flagPrice: sql`coalesce(${opportunities.flagPrice}, ${q.price})`,
            })
            .where(eq(opportunities.ticker, t));
          await this.db
            .insert(tickerDaily)
            .values({ ticker: t, day: dayKey(new Date()), close: q.price })
            .onConflictDoUpdate({ target: [tickerDaily.ticker, tickerDaily.day], set: { close: q.price } });
        }
        updated++;
        await sleep(sourceId === 'alphavantage' ? 13_000 : 250);
      } catch (e: any) {
        this.logger.warn(`${t}: ${e.message}`);
      }
    }
    return { message: `Prices updated for ${updated}/${symbols.length} tracked tickers` };
  }
}
