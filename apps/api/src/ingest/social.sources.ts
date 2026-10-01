import { Injectable, Logger } from '@nestjs/common';
import { ConfigError, fetchJson, sleep } from '../common/http';
import { ResolvedSource } from '../settings/settings.service';
import { IncomingPost, PostStoreService } from './post-store.service';

export interface RunResult {
  message: string;
  cursor?: Record<string, unknown>;
}

/** Reddit via FetchLayer (https://fetchlayer.dev/documentation/reddit) — no Reddit OAuth app needed. */
@Injectable()
export class RedditSource {
  private readonly logger = new Logger(RedditSource.name);

  constructor(private readonly store: PostStoreService) {}

  private async call<T>(src: ResolvedSource, endpoint: string, body: Record<string, unknown>): Promise<T> {
    const { apiKey } = src.credentials;
    if (!apiKey) throw new ConfigError('Reddit needs a FetchLayer API key. Get one at fetchlayer.dev.');
    const res = await fetchJson<any>(`https://api.fetchlayer.dev/reddit/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 60_000, // FetchLayer scrapes with a 45s budget
    });
    if (res?.blocked) throw new Error(`Reddit blocked the request (${res.blockReason ?? 'unknown reason'})`);
    return res as T;
  }

  async run(src: ResolvedSource): Promise<RunResult> {
    const subs: string[] = (src.options.subreddits as string[]) ?? [];
    const limit = Math.min(Number(src.options.postsPerSub ?? 100), 100);
    const commentsPerPost = Math.min(Number(src.options.commentsPerPost ?? 20), 100);
    let inserted = 0;
    let mentionCount = 0;
    const errors: string[] = [];
    if (!subs.length) throw new ConfigError('No subreddits selected');
    if (!src.credentials.apiKey) throw new ConfigError('Reddit needs a FetchLayer API key. Get one at fetchlayer.dev.');

    for (const sub of subs) {
      try {
        const listings = await Promise.all([
          this.call<any>(src, 'community-posts', { subreddit: sub, sort: 'new', limit }),
          this.call<any>(src, 'community-posts', { subreddit: sub, sort: 'hot', limit: 25, pages: 1 }),
        ]);
        const seen = new Set<string>();
        const items: IncomingPost[] = [];
        for (const listing of listings) {
          for (const p of listing?.items ?? []) {
            if (!p.id || seen.has(p.id) || p.stickied) continue;
            seen.add(p.id);
            items.push({
              sourceId: 'reddit',
              externalId: p.fullname ?? `t3_${p.id}`,
              channel: p.subredditPrefixed ?? `r/${p.subreddit ?? sub}`,
              author: p.author,
              title: p.title,
              body: p.previewText,
              url: p.permalink,
              score: p.score ?? 0,
              numComments: p.commentCount ?? 0,
              postedAt: p.createdAt ? new Date(p.createdAt) : new Date(),
            });
          }
        }
        const r = await this.store.save(items);
        inserted += r.inserted;
        mentionCount += r.mentions;

        // Comments on the busiest ticker-bearing posts — that's where DD gets challenged or amplified.
        const busy = items
          .filter((i) => (r.tickersByExt.get(i.externalId)?.length ?? 0) > 0 && i.numComments >= 10 && i.url)
          .sort((a, b) => b.numComments - a.numComments)
          .slice(0, 8);
        for (const post of busy) {
          const thread = await this.call<any>(src, 'post', { url: post.url, pages: 1, depth: 1 });
          const comments: IncomingPost[] = (thread?.comments ?? [])
            .filter((c: any) => c.bodyText && c.id && !c.stickied)
            .sort((a: any, b: any) => (b.score ?? 0) - (a.score ?? 0))
            .slice(0, commentsPerPost)
            .map((c: any) => ({
              sourceId: 'reddit',
              externalId: c.fullname ?? `t1_${c.id}`,
              channel: post.channel,
              author: c.author,
              title: null,
              body: c.bodyText,
              url: c.permalink,
              score: c.score ?? 0,
              numComments: 0,
              isComment: true,
              parentExternalId: post.externalId,
              postedAt: c.createdAt ? new Date(c.createdAt) : post.postedAt,
              inheritTickers: r.tickersByExt.get(post.externalId),
            }));
          const rc = await this.store.save(comments);
          inserted += rc.inserted;
          mentionCount += rc.mentions;
        }
      } catch (e: any) {
        this.logger.warn(`r/${sub}: ${e.message}`);
        errors.push(`r/${sub}: ${String(e.message).slice(0, 120)}`);
      }
    }
    if (errors.length === subs.length && subs.length) throw new Error(errors[0]);
    return {
      message: `${inserted} new posts/comments, ${mentionCount} ticker mentions across ${subs.length} subreddits${
        errors.length ? ` · ${errors.length} failed` : ''
      }`,
    };
  }
}

@Injectable()
export class StockTwitsSource {
  constructor(private readonly store: PostStoreService) {}

  async run(src: ResolvedSource): Promise<RunResult> {
    const trending = await fetchJson<any>('https://api.stocktwits.com/api/2/trending/symbols.json');
    const symbols: string[] = (trending.symbols ?? []).map((s: any) => s.symbol).slice(0, 15);
    let inserted = 0;
    let m = 0;
    for (const sym of symbols) {
      await sleep(400);
      try {
        const stream = await fetchJson<any>(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(sym)}.json`);
        const items: IncomingPost[] = (stream.messages ?? []).map((msg: any) => ({
          sourceId: 'stocktwits',
          externalId: String(msg.id),
          channel: 'StockTwits',
          author: msg.user?.username ?? null,
          title: null,
          body: msg.body,
          url: `https://stocktwits.com/message/${msg.id}`,
          score: msg.likes?.total ?? 0,
          numComments: 0,
          postedAt: new Date(msg.created_at),
          sentiment:
            msg.entities?.sentiment?.basic === 'Bullish' ? 0.6 : msg.entities?.sentiment?.basic === 'Bearish' ? -0.6 : null,
          knownTickers: (msg.symbols ?? []).map((s: any) => s.symbol),
        }));
        const r = await this.store.save(items);
        inserted += r.inserted;
        m += r.mentions;
      } catch {
        /* individual symbol failures are fine */
      }
    }
    return { message: `${inserted} new messages, ${m} mentions from ${symbols.length} trending symbols` };
  }
}
