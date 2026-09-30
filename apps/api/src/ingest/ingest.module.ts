import { Global, Module } from '@nestjs/common';
import { IngestService } from './ingest.service';
import { MarketDataService } from './market-data.service';
import { NewsSources, SecEdgarSource } from './news-filings.sources';
import { PostStoreService } from './post-store.service';
import { RedditSource, StockTwitsSource } from './social.sources';
import { TickersService } from './tickers.service';

@Global()
@Module({
  providers: [
    TickersService,
    PostStoreService,
    RedditSource,
    StockTwitsSource,
    MarketDataService,
    NewsSources,
    SecEdgarSource,
    IngestService,
  ],
  exports: [IngestService, TickersService, MarketDataService],
})
export class IngestModule {}
