import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AppSettingsDto, ScoreBreakdown, Thesis } from '@ff/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------- Configuration (edited from the dashboard) ----------

export const appSettings = pgTable('app_settings', {
  id: integer('id').primaryKey().default(1),
  value: jsonb('value').$type<AppSettingsDto>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const aiProviders = pgTable('ai_providers', {
  id: text('id').primaryKey(), // catalog id
  enabled: boolean('enabled').notNull().default(false),
  baseUrl: text('base_url').notNull(),
  apiKeyEnc: text('api_key_enc'),
  models: jsonb('models').$type<string[]>().notNull().default([]),
  lastTestedAt: ts('last_tested_at'),
  lastTestOk: boolean('last_test_ok'),
  lastTestMessage: text('last_test_message'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const aiRoles = pgTable('ai_roles', {
  role: text('role').primaryKey(), // ANALYST | FAST | WEB_RESEARCH
  providerId: text('provider_id'),
  model: text('model'),
  inputPricePerMTok: doublePrecision('input_price_per_mtok'),
  outputPricePerMTok: doublePrecision('output_price_per_mtok'),
});

export const sources = pgTable('sources', {
  id: text('id').primaryKey(), // catalog id
  enabled: boolean('enabled').notNull().default(false),
  intervalMin: integer('interval_min').notNull(),
  options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
  credentialsEnc: text('credentials_enc'),
  lastRunAt: ts('last_run_at'),
  lastRunOk: boolean('last_run_ok'),
  lastRunMessage: text('last_run_message'),
  cursor: jsonb('cursor').$type<Record<string, unknown>>().notNull().default({}),
});

// ---------- Reference data ----------

export const tickers = pgTable('tickers', {
  symbol: text('symbol').primaryKey(),
  name: text('name'),
  cik: text('cik'),
  exchange: text('exchange'),
  sector: text('sector'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ---------- Raw ingested content (the internal dataset) ----------

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id').notNull(),
    channel: text('channel').notNull(), // e.g. r/wallstreetbets
    author: text('author'),
    title: text('title'),
    body: text('body'),
    url: text('url'),
    score: integer('score').notNull().default(0),
    numComments: integer('num_comments').notNull().default(0),
    isComment: boolean('is_comment').notNull().default(false),
    parentExternalId: text('parent_external_id'),
    postedAt: ts('posted_at').notNull(),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
    tickers: jsonb('tickers').$type<string[]>().notNull().default([]),
    sentiment: doublePrecision('sentiment'),
    quality: text('quality'), // DD | HYPE | NEWS | QUESTION | PROMO | OTHER
    classifiedAt: ts('classified_at'),
  },
  (t) => [
    uniqueIndex('posts_source_ext_uq').on(t.sourceId, t.externalId),
    index('posts_posted_at_idx').on(t.postedAt),
    index('posts_unclassified_idx').on(t.classifiedAt),
  ],
);

export const mentions = pgTable(
  'mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    ticker: text('ticker').notNull(),
    channel: text('channel').notNull(),
    author: text('author'),
    postedAt: ts('posted_at').notNull(),
  },
  (t) => [
    index('mentions_ticker_time_idx').on(t.ticker, t.postedAt),
    uniqueIndex('mentions_post_ticker_uq').on(t.postId, t.ticker),
  ],
);

/** One row per ticker per day. Grows forever and feeds scoring + learning. */
export const tickerDaily = pgTable(
  'ticker_daily',
  {
    ticker: text('ticker').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    mentions: integer('mentions').notNull().default(0),
    uniqueAuthors: integer('unique_authors').notNull().default(0),
    avgSentiment: doublePrecision('avg_sentiment'),
    close: doublePrecision('close'),
    volume: doublePrecision('volume'),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.day] })],
);

export const newsItems = pgTable(
  'news_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: text('source_id').notNull(),
    externalId: text('external_id').notNull(),
    ticker: text('ticker').notNull(),
    publisher: text('publisher'),
    title: text('title').notNull(),
    summary: text('summary'),
    url: text('url'),
    publishedAt: ts('published_at').notNull(),
  },
  (t) => [
    uniqueIndex('news_source_ext_uq').on(t.sourceId, t.externalId),
    index('news_ticker_idx').on(t.ticker, t.publishedAt),
  ],
);

export const filings = pgTable(
  'filings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    cik: text('cik').notNull(),
    form: text('form').notNull(),
    accession: text('accession').notNull(),
    filedAt: ts('filed_at').notNull(),
    url: text('url'),
    description: text('description'),
  },
  (t) => [uniqueIndex('filings_accession_uq').on(t.accession), index('filings_ticker_idx').on(t.ticker, t.filedAt)],
);

// ---------- Opportunities & research ----------

export const opportunities = pgTable(
  'opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    stage: text('stage').notNull().default('EMERGING'),
    score: doublePrecision('score'),
    breakdown: jsonb('breakdown').$type<ScoreBreakdown>(),
    thesis: jsonb('thesis').$type<Thesis>(),
    themes: jsonb('themes').$type<string[]>().notNull().default([]),
    saturation: doublePrecision('saturation').notNull().default(0),
    mentions24h: integer('mentions_24h').notNull().default(0),
    mentions7d: integer('mentions_7d').notNull().default(0),
    mentionGrowth7d: doublePrecision('mention_growth_7d'),
    uniqueAuthors7d: integer('unique_authors_7d').notNull().default(0),
    sentiment: doublePrecision('sentiment'),
    price: doublePrecision('price'),
    change1d: doublePrecision('change_1d'),
    autoPriority: doublePrecision('auto_priority').notNull().default(0),
    priorityOverride: text('priority_override'), // PINNED | HIGH | LOW | PAUSED | null (=AUTO)
    watch: boolean('watch').notNull().default(false),
    dismissed: boolean('dismissed').notNull().default(false),
    firstFlaggedAt: ts('first_flagged_at').notNull().defaultNow(),
    flagPrice: doublePrecision('flag_price'),
    lastResearchedAt: ts('last_researched_at'),
    nextResearchAt: ts('next_research_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('opportunities_ticker_uq').on(t.ticker)],
);

export const analyses = pgTable(
  'analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticker: text('ticker').notNull(),
    opportunityId: uuid('opportunity_id'),
    positionId: uuid('position_id'),
    kind: text('kind').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    score: doublePrecision('score'),
    previousScore: doublePrecision('previous_score'),
    summary: text('summary').notNull(),
    output: jsonb('output'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd'),
    createdAt: createdAt(),
  },
  (t) => [index('analyses_ticker_idx').on(t.ticker, t.createdAt)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    status: text('status').notNull().default('QUEUED'),
    target: text('target'),
    priority: doublePrecision('priority').notNull().default(0),
    priorityOverride: text('priority_override'),
    progress: doublePrecision('progress').notNull().default(0),
    message: text('message'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    provider: text('provider'),
    model: text('model'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: ts('run_after').notNull().defaultNow(),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('jobs_status_idx').on(t.status, t.priority), index('jobs_created_idx').on(t.createdAt)],
);

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role: text('role').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    jobId: uuid('job_id'),
    createdAt: createdAt(),
  },
  (t) => [index('llm_usage_created_idx').on(t.createdAt)],
);

// ---------- Portfolio ----------

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticker: text('ticker').notNull(),
  quantity: doublePrecision('quantity').notNull(),
  entryPrice: doublePrecision('entry_price').notNull(),
  entryDate: date('entry_date', { mode: 'string' }).notNull(),
  notes: text('notes'),
  closedAt: ts('closed_at'),
  exitPrice: doublePrecision('exit_price'),
  lastReviewedAt: ts('last_reviewed_at'),
  createdAt: createdAt(),
});

export const advice = pgTable(
  'advice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    positionId: uuid('position_id')
      .notNull()
      .references(() => positions.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    confidence: doublePrecision('confidence').notNull(),
    rationale: text('rationale').notNull(),
    stopLoss: doublePrecision('stop_loss'),
    takeProfit: doublePrecision('take_profit'),
    analysisId: uuid('analysis_id'),
    createdAt: createdAt(),
  },
  (t) => [index('advice_position_idx').on(t.positionId, t.createdAt)],
);

// ---------- Learning loop ----------

/** What actually happened N days after a signal was flagged. */
export const outcomes = pgTable(
  'outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    opportunityId: uuid('opportunity_id').notNull(),
    ticker: text('ticker').notNull(),
    horizonDays: integer('horizon_days').notNull(),
    flaggedAt: ts('flagged_at').notNull(),
    flagPrice: doublePrecision('flag_price').notNull(),
    scoreAtFlag: doublePrecision('score_at_flag'),
    stageAtFlag: text('stage_at_flag'),
    breakdownAtFlag: jsonb('breakdown_at_flag').$type<ScoreBreakdown>(),
    priceAfter: doublePrecision('price_after').notNull(),
    returnPct: doublePrecision('return_pct').notNull(),
    labeledAt: createdAt(),
  },
  (t) => [uniqueIndex('outcomes_opp_horizon_uq').on(t.opportunityId, t.horizonDays)],
);
