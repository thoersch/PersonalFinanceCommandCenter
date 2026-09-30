/**
 * Seeds FICTIONAL demo data so the dashboard can be explored before any API keys are configured.
 *   npm run seed:demo           — insert demo data
 *   npm run seed:demo -- --clear — remove it again
 * Every demo ticker ends in "(demo)" in its company name and every demo post has source_id = 'demo'.
 */
import 'reflect-metadata';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { inArray, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import * as path from 'path';
import * as schema from '../db/schema';
import { SignalsService } from '../signals/signals.service';
import { SettingsService } from '../settings/settings.service';
import { dayKey, daysAgo } from '../common/http';

const DEMO = [
  { t: 'VYTX', name: 'Vyntrix Therapeutics', themes: ['GLP-1 small caps'], curve: 'explode', authors: 180, price: 4.6, drift: 0.02 },
  { t: 'KRNL', name: 'Kernelight Semiconductor', themes: ['Custom AI silicon'], curve: 'ramp', authors: 420, price: 18.2, drift: 0.008 },
  { t: 'ODRA', name: 'Odra Grid Storage', themes: ['Grid storage'], curve: 'explode', authors: 90, price: 7.1, drift: 0.004 },
  { t: 'HLDR', name: 'Holder Freight', themes: ['Nearshoring'], curve: 'peak', authors: 600, price: 22.4, drift: 0.01 },
  { t: 'BNQT', name: 'Banquet Brands', themes: ['GLP-1 small caps'], curve: 'ramp', authors: 70, price: 3.3, drift: 0.006 },
  { t: 'PXAR', name: 'Paxar Aerospace', themes: ['Defense drones'], curve: 'crowded', authors: 5000, price: 41.0, drift: 0.012 },
  { t: 'MNTL', name: 'Mantle Mining', themes: ['Uranium restarts'], curve: 'fade', authors: 260, price: 9.8, drift: -0.006 },
  { t: 'CYFR', name: 'Cypher Cloud', themes: ['Custom AI silicon'], curve: 'crowded', authors: 4000, price: 63.5, drift: 0.003 },
  { t: 'LUMQ', name: 'Lumiq Photonics', themes: ['Custom AI silicon', 'Grid storage'], curve: 'explode', authors: 60, price: 2.4, drift: 0.015 },
  { t: 'TRVE', name: 'Traverse Rail', themes: ['Nearshoring'], curve: 'ramp', authors: 150, price: 12.9, drift: 0.002 },
];
const CHANNELS = ['r/wallstreetbets', 'r/stocks', 'r/pennystocks', 'r/options', 'r/investing', 'StockTwits'];

function mentionsOn(curve: string, d: number): number {
  const x = (36 - d) / 36; // 0 = oldest, 1 = today
  switch (curve) {
    case 'explode':
      return Math.round(1 + 60 * Math.pow(x, 6));
    case 'ramp':
      return Math.round(2 + 25 * Math.pow(x, 2.5));
    case 'peak':
      return Math.round(4 + 40 * Math.exp(-Math.pow((x - 0.8) / 0.12, 2)));
    case 'crowded':
      return Math.round(110 + 40 * x);
    case 'fade':
      return Math.round(4 + 30 * Math.exp(-Math.pow((x - 0.4) / 0.15, 2)));
    default:
      return 2;
  }
}

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/finance_finder' });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  const tick = DEMO.map((d) => d.t);

  // Always clear old demo rows first.
  await db.delete(schema.posts).where(sql`${schema.posts.sourceId} = 'demo'`);
  await db.delete(schema.tickerDaily).where(inArray(schema.tickerDaily.ticker, tick));
  await db.delete(schema.analyses).where(inArray(schema.analyses.ticker, tick));
  await db.delete(schema.positions).where(inArray(schema.positions.ticker, tick));
  await db.delete(schema.opportunities).where(inArray(schema.opportunities.ticker, tick));
  await db.delete(schema.jobs).where(sql`${schema.jobs.payload} ->> 'demo' = 'true'`);
  if (process.argv.includes('--clear')) {
    await db.delete(schema.tickers).where(inArray(schema.tickers.symbol, tick));
    console.log('Demo data removed.');
    await pool.end();
    return;
  }

  await db
    .insert(schema.tickers)
    .values(DEMO.map((d) => ({ symbol: d.t, name: `${d.name} (demo)`, exchange: 'DEMO', cik: null })))
    .onConflictDoNothing();

  // Posts + mentions, 37 days.
  let n = 0;
  for (const d of DEMO) {
    for (let day = 36; day >= 0; day--) {
      const count = mentionsOn(d.curve, day);
      const rows = [];
      for (let i = 0; i < count; i++) {
        const author = `demo_user_${Math.floor(rand() * d.authors)}`;
        const spread = d.curve === 'explode' ? 3 : CHANNELS.length;
        const channel = CHANNELS[Math.floor(Math.pow(rand(), d.curve === 'crowded' ? 1 : 2.2) * spread)];
        const quality = rand() < 0.15 ? 'DD' : rand() < 0.6 ? 'HYPE' : 'OTHER';
        rows.push({
          sourceId: 'demo',
          externalId: `${d.t}-${day}-${i}`,
          channel,
          author,
          title: quality === 'DD' ? `$${d.t} deep dive: why the market is missing this` : `$${d.t} anyone watching this?`,
          body: `Demo post about ${d.name}. This is fictional sample content.`,
          url: null,
          score: Math.round(rand() * (quality === 'DD' ? 1500 : 300)),
          numComments: Math.round(rand() * 200),
          postedAt: new Date(daysAgo(day).getTime() - rand() * 20 * 3_600_000),
          tickers: [d.t],
          sentiment: d.curve === 'fade' ? rand() - 0.6 : rand() * 1.2 - 0.3,
          quality,
          classifiedAt: new Date(),
        });
      }
      if (!rows.length) continue;
      const inserted = await db.insert(schema.posts).values(rows).returning({ id: schema.posts.id, postedAt: schema.posts.postedAt, channel: schema.posts.channel, author: schema.posts.author });
      await db.insert(schema.mentions).values(inserted.map((p) => ({ postId: p.id, ticker: d.t, channel: p.channel, author: p.author, postedAt: p.postedAt })));
      n += rows.length;
    }
  }

  // Daily dataset rows incl. a random-walk price.
  await db.execute(sql`
    INSERT INTO ticker_daily (ticker, day, mentions, unique_authors, avg_sentiment)
    SELECT m.ticker, (m.posted_at AT TIME ZONE 'UTC')::date, count(*)::int, count(DISTINCT m.author)::int, avg(p.sentiment)
    FROM mentions m JOIN posts p ON p.id = m.post_id WHERE p.source_id = 'demo' GROUP BY 1, 2
    ON CONFLICT (ticker, day) DO UPDATE SET mentions = excluded.mentions, unique_authors = excluded.unique_authors`);
  const lastPrice = new Map<string, { p: number; prev: number }>();
  for (const d of DEMO) {
    let p = d.price;
    let prev = p;
    for (let day = 89; day >= 0; day--) {
      prev = p;
      const boost = day < 14 ? d.drift * 2 : d.drift * 0.3;
      p = Math.max(0.5, p * (1 + boost + (rand() - 0.5) * 0.05));
      await db
        .insert(schema.tickerDaily)
        .values({ ticker: d.t, day: dayKey(daysAgo(day)), close: Number(p.toFixed(2)) })
        .onConflictDoUpdate({ target: [schema.tickerDaily.ticker, schema.tickerDaily.day], set: { close: Number(p.toFixed(2)) } });
    }
    lastPrice.set(d.t, { p, prev });
  }

  const settings = new SettingsService(db as any);
  await settings.onModuleInit();
  await new SignalsService(db as any, settings).aggregate();

  // Fake analysis results so the UI has theses to show.
  const opps = await db.select().from(schema.opportunities).where(inArray(schema.opportunities.ticker, tick));
  for (const o of opps) {
    const d = DEMO.find((x) => x.t === o.ticker)!;
    const lp = lastPrice.get(o.ticker)!;
    const score = Math.round(40 + rand() * 20 + (o.stage === 'EMERGING' ? 25 : o.stage === 'ACCELERATING' ? 15 : o.stage === 'CROWDED' ? 5 : -10));
    const firstFlag = daysAgo(o.stage === 'EMERGING' ? 6 : 14);
    await db
      .update(schema.opportunities)
      .set({
        score,
        themes: d.themes,
        price: Number(lp.p.toFixed(2)),
        change1d: lp.p / lp.prev - 1,
        firstFlaggedAt: firstFlag,
        flagPrice: Number((lp.p / (1 + d.drift * 20)).toFixed(2)),
        lastResearchedAt: daysAgo(rand() * 0.5),
        nextResearchAt: new Date(Date.now() + 3_600_000 * (1 + rand() * 6)),
        breakdown: {
          momentum: Math.round(50 + rand() * 45),
          earlyWindow: Math.round((1 - o.saturation) * 100),
          catalyst: Math.round(40 + rand() * 50),
          sourceQuality: Math.round(40 + rand() * 45),
          fundamentals: Math.round(35 + rand() * 45),
        },
        thesis: {
          summary: `DEMO — fictional thesis for ${d.name}. Chatter is ${o.stage.toLowerCase()} around the "${d.themes[0]}" theme.`,
          bull: ['Demo bull point: catalyst confirmed in a filing', 'Demo bull point: insider buying'],
          bear: ['Demo risk: dilution likely', 'Demo risk: possible coordinated promotion'],
          catalysts: [{ date: 'Q4', label: 'Demo catalyst' }],
          confidence: 'MEDIUM',
          horizon: '2-6 weeks',
        },
        priorityOverride: o.ticker === 'VYTX' ? 'PINNED' : o.ticker === 'HLDR' ? 'HIGH' : null,
      })
      .where(inArray(schema.opportunities.ticker, [o.ticker]));
    await db.insert(schema.analyses).values([
      { ticker: o.ticker, opportunityId: o.id, kind: 'DEEP_DIVE', provider: 'demo', model: 'demo-analyst', score: score - 3, previousScore: null, summary: 'Initial analysis (demo)', createdAt: daysAgo(1) },
      { ticker: o.ticker, opportunityId: o.id, kind: 'DEEP_DIVE', provider: 'demo', model: 'demo-analyst', score, previousScore: score - 3, summary: 'Raised catalyst proximity after new filing (demo)', createdAt: daysAgo(0.1) },
    ]);
  }

  const pos = await db
    .insert(schema.positions)
    .values([
      { ticker: 'HLDR', quantity: 200, entryPrice: 17.1, entryDate: dayKey(daysAgo(20)), notes: 'Demo position' },
      { ticker: 'KRNL', quantity: 50, entryPrice: 16.4, entryDate: dayKey(daysAgo(9)), notes: 'Demo position' },
      { ticker: 'MNTL', quantity: 300, entryPrice: 10.6, entryDate: dayKey(daysAgo(25)), notes: 'Demo position' },
    ])
    .returning();
  const adv = { HLDR: ['TRIM', 0.7, 'DEMO: mention velocity is rolling over while price keeps rising — a classic late-hype pattern.'], KRNL: ['HOLD', 0.65, 'DEMO: still accelerating and not yet crowded.'], MNTL: ['SELL', 0.75, 'DEMO: thesis broken and chatter turned bearish.'] } as const;
  for (const p of pos) {
    const [a, c, r] = adv[p.ticker as keyof typeof adv];
    await db.insert(schema.advice).values({ positionId: p.id, action: a, confidence: c, rationale: r, stopLoss: Number((p.entryPrice * 0.9).toFixed(2)), takeProfit: Number((p.entryPrice * 1.4).toFixed(2)) });
  }

  await db.insert(schema.jobs).values([
    { type: 'DEEP_DIVE', target: 'VYTX', status: 'DONE', priority: 95, priorityOverride: 'PINNED', progress: 1, message: 'VYTX scored 84 → 87 (demo)', provider: 'demo', model: 'demo-analyst', finishedAt: new Date(), startedAt: new Date(), payload: { demo: true } },
    { type: 'DEEP_DIVE', target: 'ODRA', status: 'RUNNING', priority: 80, progress: 0.6, message: 'Analyst model reasoning (demo)', startedAt: new Date(), payload: { demo: true } },
    { type: 'DEEP_DIVE', target: 'LUMQ', status: 'QUEUED', priority: 77, message: 'New signal (demo)', payload: { demo: true } },
    { type: 'DEEP_DIVE', target: 'TRVE', status: 'QUEUED', priority: 52, message: 'Refresh stale research (demo)', payload: { demo: true } },
  ]);

  // Re-run once so saturation reflects the back-dated flag times.
  await new SignalsService(db as any, settings).aggregate();
  console.log(`Seeded ${n} demo posts across ${DEMO.length} fictional tickers.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
