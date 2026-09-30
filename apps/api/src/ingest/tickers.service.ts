import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { opportunities, positions, tickers } from '../db/schema';
import { fetchJson } from '../common/http';
import { SettingsService } from '../settings/settings.service';

/** Symbols we never want to treat as ticker mentions even though SEC lists them. */
const EXCLUDED_EXCHANGES = new Set<string>([]);

@Injectable()
export class TickersService {
  private readonly logger = new Logger(TickersService.name);
  private valid = new Set<string>();
  private loadedAt = 0;
  private lastAttempt = 0;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async secUserAgent(): Promise<string> {
    const sec = await this.settings.resolveSource('sec-edgar');
    return sec.credentials.userAgent || process.env.SEC_USER_AGENT || 'FinanceFinder admin@example.com';
  }

  /** Refresh the ticker universe from SEC (free, ~10k listed symbols) at most once a week. */
  async ensureUniverse(force = false): Promise<number> {
    const [{ n, newest }] = await this.db
      .select({ n: sql<number>`count(*)::int`, newest: sql<Date | null>`max(${tickers.updatedAt})` })
      .from(tickers);
    const stale = !newest || Date.now() - new Date(newest).getTime() > 7 * 86_400_000;
    if ((force || n === 0 || stale) && (force || Date.now() - this.lastAttempt > 30 * 60_000)) {
      this.lastAttempt = Date.now();
      try {
        const res = await fetchJson<{ fields: string[]; data: [number, string, string, string][] }>(
          'https://www.sec.gov/files/company_tickers_exchange.json',
          { headers: { 'User-Agent': await this.secUserAgent() }, timeoutMs: 30_000 },
        );
        const rows = res.data
          .filter(([, , t, ex]) => t && !EXCLUDED_EXCHANGES.has(ex))
          .map(([cik, name, ticker, exchange]) => ({
            symbol: ticker.toUpperCase().replace('-', '.'),
            name,
            cik: String(cik).padStart(10, '0'),
            exchange,
            updatedAt: new Date(),
          }));
        for (let i = 0; i < rows.length; i += 1000) {
          await this.db
            .insert(tickers)
            .values(rows.slice(i, i + 1000))
            .onConflictDoUpdate({
              target: tickers.symbol,
              set: {
                name: sql`excluded.name`,
                cik: sql`excluded.cik`,
                exchange: sql`excluded.exchange`,
                updatedAt: sql`excluded.updated_at`,
              },
            });
        }
        this.logger.log(`Loaded ${rows.length} tickers from SEC`);
      } catch (e: any) {
        this.logger.warn(`Could not refresh ticker universe: ${e.message}`);
      }
    }
    await this.loadCache();
    return this.valid.size;
  }

  async validSet(): Promise<Set<string>> {
    if (!this.valid.size || Date.now() - this.loadedAt > 3_600_000) await this.ensureUniverse();
    return this.valid;
  }

  private async loadCache() {
    const rows = await this.db.select({ s: tickers.symbol }).from(tickers);
    this.valid = new Set(rows.map((r) => r.s));
    this.loadedAt = Date.now();
  }

  async info(symbols: string[]) {
    if (!symbols.length) return new Map<string, typeof tickers.$inferSelect>();
    const rows = await this.db.select().from(tickers).where(inArray(tickers.symbol, symbols));
    return new Map(rows.map((r) => [r.symbol, r]));
  }

  /** Tickers worth spending API calls on: open positions + top live opportunities. */
  async tracked(limit = 25): Promise<string[]> {
    const held = await this.db.select({ t: positions.ticker }).from(positions).where(isNull(positions.closedAt));
    const opps = await this.db
      .select({ t: opportunities.ticker })
      .from(opportunities)
      .where(and(eq(opportunities.dismissed, false)))
      .orderBy(desc(opportunities.autoPriority))
      .limit(limit);
    return [...new Set([...held.map((h) => h.t), ...opps.map((o) => o.t)])];
  }
}
