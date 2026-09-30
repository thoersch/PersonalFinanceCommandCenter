import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { MarketDataService } from './market-data.service';
import { NewsSources, SecEdgarSource } from './news-filings.sources';
import { RedditSource, RunResult, StockTwitsSource } from './social.sources';
import { TickersService } from './tickers.service';

/** Dispatches a source id to its runner and records the outcome on the source row. */
@Injectable()
export class IngestService {
  constructor(
    private readonly settings: SettingsService,
    private readonly tickers: TickersService,
    private readonly reddit: RedditSource,
    private readonly stocktwits: StockTwitsSource,
    private readonly market: MarketDataService,
    private readonly news: NewsSources,
    private readonly sec: SecEdgarSource,
  ) {}

  async run(sourceId: string): Promise<RunResult> {
    const src = await this.settings.resolveSource(sourceId);
    await this.tickers.ensureUniverse();
    try {
      let result: RunResult;
      switch (sourceId) {
        case 'reddit':
          result = await this.reddit.run(src);
          break;
        case 'stocktwits':
          result = await this.stocktwits.run(src);
          break;
        case 'polygon':
        case 'finnhub':
        case 'alphavantage':
          result = await this.market.sync(sourceId);
          break;
        case 'finnhub-news':
          result = await this.news.finnhub(src);
          break;
        case 'newsapi':
          result = await this.news.newsapi(src);
          break;
        case 'sec-edgar':
          result = await this.sec.run(src);
          break;
        default:
          throw new Error(`No runner for source ${sourceId}`);
      }
      await this.settings.recordSourceRun(sourceId, true, result.message, result.cursor);
      return result;
    } catch (e: any) {
      await this.settings.recordSourceRun(sourceId, false, String(e?.message ?? e));
      throw e;
    }
  }
}
