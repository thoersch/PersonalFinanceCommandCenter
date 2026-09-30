import { Injectable, Logger } from '@nestjs/common';
import { ConfigError, fetchJson, sleep } from '../common/http';
import { ResolvedSource } from '../settings/settings.service';
import { IncomingPost, PostStoreService } from './post-store.service';

export interface RunResult {
  message: string;
  cursor?: Record<string, unknown>;
}

@Injectable()
export class RedditSource {
  private readonly logger = new Logger(RedditSource.name);
  private token: { value: string; expires: number; clientId: string } | null = null;

  constructor(private readonly store: PostStoreService) {}

  private async auth(src: ResolvedSource): Promise<string> {
    const { clientId, clientSecret, userAgent } = src.credentials;
    if (!clientId || !clientSecret || !userAgent) {
      throw new ConfigError('Reddit needs a client ID, client secret and user agent. Create a "script" app at reddit.com/prefs/apps.');
    }
    if (this.token && this.token.clientId === clientId && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetchJson<{ access_token: string; expires_in: number }>('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': userAgent,
      },
      body: 'grant_type=client_credentials',
    });
    this.token = { value: res.access_token, expires: Date.now() + res.expires_in * 1000, clientId };
    return res.access_token;
  }

  private async get<T>(src: ResolvedSource, path: string): Promise<T> {
    const token = await this.auth(src);
    await sleep(700); // stay well under Reddit's 100 req/min
    return fetchJson<T>(`https://oauth.reddit.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': src.credentials.userAgent },
    });
  }

  async run(src: ResolvedSource): Promise<RunResult> {
    const subs: string[] = (src.options.subreddits as string[]) ?? [];
    const limit = Math.min(Number(src.options.postsPerSub ?? 100), 100);
    const commentsPerPost = Math.min(Number(src.options.commentsPerPost ?? 20), 100);
    let inserted = 0;
    let mentionCount = 0;
    const errors: string[] = [];
    if (!subs.length) throw new ConfigError('No subreddits selected');
    await this.auth(src); // fail fast on bad credentials

    for (const sub of subs) {
      try {
        const listings = await Promise.all([
          this.get<any>(src, `/r/${encodeURIComponent(sub)}/new?limit=${limit}&raw_json=1`),
          this.get<any>(src, `/r/${encodeURIComponent(sub)}/hot?limit=25&raw_json=1`),
        ]);
        const seen = new Set<string>();
        const items: IncomingPost[] = [];
        for (const listing of listings) {
          for (const { data: p } of listing?.data?.children ?? []) {
            if (seen.has(p.id) || p.stickied) continue;
            seen.add(p.id);
            items.push({
              sourceId: 'reddit',
              externalId: p.name,
              channel: `r/${p.subreddit}`,
              author: p.author,
              title: p.title,
              body: p.selftext,
              url: `https://www.reddit.com${p.permalink}`,
              score: p.score ?? 0,
              numComments: p.num_comments ?? 0,
              postedAt: new Date(p.created_utc * 1000),
            });
          }
        }
        const r = await this.store.save(items);
        inserted += r.inserted;
        mentionCount += r.mentions;

        // Comments on the busiest ticker-bearing posts — that's where DD gets challenged or amplified.
        const busy = items
          .filter((i) => (r.tickersByExt.get(i.externalId)?.length ?? 0) > 0 && i.numComments >= 10)
          .sort((a, b) => b.numComments - a.numComments)
          .slice(0, 8);
        for (const post of busy) {
          const id = post.externalId.replace(/^t3_/, '');
          const thread = await this.get<any[]>(
            src,
            `/r/${encodeURIComponent(sub)}/comments/${id}?limit=${commentsPerPost}&depth=1&sort=top&raw_json=1`,
          );
          const comments: IncomingPost[] = (thread?.[1]?.data?.children ?? [])
            .filter((c: any) => c.kind === 't1' && c.data?.body)
            .map((c: any) => ({
              sourceId: 'reddit',
              externalId: c.data.name,
              channel: post.channel,
              author: c.data.author,
              title: null,
              body: c.data.body,
              url: `https://www.reddit.com${c.data.permalink}`,
              score: c.data.score ?? 0,
              numComments: 0,
              isComment: true,
              parentExternalId: post.externalId,
              postedAt: new Date(c.data.created_utc * 1000),
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
