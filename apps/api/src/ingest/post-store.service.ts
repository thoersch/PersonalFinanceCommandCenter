import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { mentions, posts } from '../db/schema';
import { extractTickers } from './ticker-extractor';
import { TickersService } from './tickers.service';

export interface IncomingPost {
  sourceId: string;
  externalId: string;
  channel: string;
  author: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  score: number;
  numComments: number;
  isComment?: boolean;
  parentExternalId?: string | null;
  postedAt: Date;
  /** Pre-labelled sentiment from the source, e.g. StockTwits Bullish/Bearish. */
  sentiment?: number | null;
  /** Tickers the source already knows (e.g. the StockTwits symbol stream). */
  knownTickers?: string[];
  /** For comments: tickers from the parent post, used when the comment has none of its own. */
  inheritTickers?: string[];
}

@Injectable()
export class PostStoreService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tickers: TickersService,
  ) {}

  /** Upserts posts, refreshes engagement numbers, and records ticker mentions. Returns new post count. */
  async save(items: IncomingPost[]): Promise<{ inserted: number; mentions: number; tickersByExt: Map<string, string[]> }> {
    const valid = await this.tickers.validSet();
    let inserted = 0;
    let mentionCount = 0;
    const tickersByExt = new Map<string, string[]>();
    for (const it of items) {
      let found = extractTickers(`${it.title ?? ''}\n${it.body ?? ''}`, valid);
      for (const k of it.knownTickers ?? []) if ((valid.has(k) || !valid.size) && !found.includes(k)) found.push(k);
      if (!found.length && it.inheritTickers?.length) found = it.inheritTickers;
      tickersByExt.set(it.externalId, found);

      const [row] = await this.db
        .insert(posts)
        .values({
          sourceId: it.sourceId,
          externalId: it.externalId,
          channel: it.channel,
          author: it.author,
          title: it.title?.slice(0, 1000) ?? null,
          body: it.body?.slice(0, 20_000) ?? null,
          url: it.url,
          score: it.score,
          numComments: it.numComments,
          isComment: it.isComment ?? false,
          parentExternalId: it.parentExternalId ?? null,
          postedAt: it.postedAt,
          tickers: found,
          sentiment: it.sentiment ?? null,
        })
        .onConflictDoUpdate({
          target: [posts.sourceId, posts.externalId],
          set: { score: sql`excluded.score`, numComments: sql`excluded.num_comments` },
        })
        .returning({ id: posts.id, inserted: sql<boolean>`(xmax = 0)` });
      if (!row?.inserted) continue;
      inserted++;
      if (found.length) {
        await this.db
          .insert(mentions)
          .values(
            found.map((t) => ({ postId: row.id, ticker: t, channel: it.channel, author: it.author, postedAt: it.postedAt })),
          )
          .onConflictDoNothing();
        mentionCount += found.length;
      }
    }
    return { inserted, mentions: mentionCount, tickersByExt };
  }
}
