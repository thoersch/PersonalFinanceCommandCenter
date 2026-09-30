import { Injectable, Logger } from '@nestjs/common';
import { Db, InjectDb } from '../db/db.module';
import { filings, newsItems } from '../db/schema';
import { ConfigError, dayKey, daysAgo, fetchJson, sleep } from '../common/http';
import { ResolvedSource, SettingsService } from '../settings/settings.service';
import { TickersService } from './tickers.service';
import { RunResult } from './social.sources';

@Injectable()
export class NewsSources {
  private readonly logger = new Logger(NewsSources.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tickers: TickersService,
    private readonly settings: SettingsService,
  ) {}

  async finnhub(src: ResolvedSource): Promise<RunResult> {
    let key = src.credentials.apiKey;
    if (!key) key = (await this.settings.resolveSource('finnhub')).credentials.apiKey;
    if (!key) throw new ConfigError('Add a Finnhub API key');
    const days = Number(src.options.lookbackDays ?? 7);
    const symbols = await this.tickers.tracked(25);
    let n = 0;
    for (const t of symbols) {
      const items = await fetchJson<any[]>(
        `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(t)}&from=${dayKey(daysAgo(days))}&to=${dayKey(new Date())}&token=${key}`,
      );
      const rows = (items ?? []).slice(0, 20).map((a) => ({
        sourceId: 'finnhub-news',
        externalId: String(a.id),
        ticker: t,
        publisher: a.source ?? null,
        title: a.headline,
        summary: a.summary ?? null,
        url: a.url ?? null,
        publishedAt: new Date(a.datetime * 1000),
      }));
      if (rows.length) {
        const r = await this.db.insert(newsItems).values(rows).onConflictDoNothing().returning({ id: newsItems.id });
        n += r.length;
      }
      await sleep(1100); // free tier: 60/min
    }
    return { message: `${n} new articles for ${symbols.length} tickers` };
  }

  async newsapi(src: ResolvedSource): Promise<RunResult> {
    const key = src.credentials.apiKey;
    if (!key) throw new ConfigError('Add a NewsAPI key');
    const days = Number(src.options.lookbackDays ?? 7);
    const symbols = await this.tickers.tracked(15);
    const info = await this.tickers.info(symbols);
    let n = 0;
    for (const t of symbols) {
      const name = info.get(t)?.name?.replace(/\b(inc|corp|corporation|ltd|plc|holdings|co)\.?$/i, '').trim();
      const q = name ? `"${name}" OR "$${t}"` : `"$${t}"`;
      const res = await fetchJson<any>(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&from=${dayKey(daysAgo(days))}&sortBy=publishedAt&language=en&pageSize=20&apiKey=${key}`,
      );
      const rows = (res.articles ?? []).map((a: any) => ({
        sourceId: 'newsapi',
        externalId: a.url,
        ticker: t,
        publisher: a.source?.name ?? null,
        title: a.title,
        summary: a.description ?? null,
        url: a.url,
        publishedAt: new Date(a.publishedAt),
      }));
      if (rows.length) {
        const r = await this.db.insert(newsItems).values(rows).onConflictDoNothing().returning({ id: newsItems.id });
        n += r.length;
      }
    }
    return { message: `${n} new articles for ${symbols.length} tickers` };
  }
}

@Injectable()
export class SecEdgarSource {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tickers: TickersService,
  ) {}

  async run(src: ResolvedSource): Promise<RunResult> {
    const ua = await this.tickers.secUserAgent();
    const forms = new Set<string>((src.options.forms as string[]) ?? ['8-K', '4', '10-Q', '10-K']);
    const symbols = await this.tickers.tracked(30);
    const info = await this.tickers.info(symbols);
    const since = daysAgo(90);
    let n = 0;
    for (const t of symbols) {
      const cik = info.get(t)?.cik;
      if (!cik) continue;
      await sleep(150); // SEC fair-access: max 10 req/s
      const sub = await fetchJson<any>(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: { 'User-Agent': ua },
      });
      const r = sub.filings?.recent;
      if (!r) continue;
      const rows = [];
      for (let i = 0; i < r.accessionNumber.length; i++) {
        const filed = new Date(r.filingDate[i]);
        if (filed < since) break;
        if (!forms.has(r.form[i])) continue;
        const acc = r.accessionNumber[i];
        rows.push({
          ticker: t,
          cik,
          form: r.form[i],
          accession: acc,
          filedAt: filed,
          url: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${r.primaryDocument[i]}`,
          description: r.primaryDocDescription?.[i] || r.items?.[i] || null,
        });
      }
      if (rows.length) {
        const ins = await this.db.insert(filings).values(rows).onConflictDoNothing().returning({ id: filings.id });
        n += ins.length;
      }
    }
    return { message: `${n} new filings for ${symbols.length} tickers` };
  }
}
