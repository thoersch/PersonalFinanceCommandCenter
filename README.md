# Finance Finder

A personal command center that watches retail-investor chatter (Reddit, StockTwits), market data, news and SEC filings, uses AI to research and rank opportunities **before they get crowded**, and then monitors the positions you take with hold / trim / sell advice.

> Decision support for one person, not financial advice. Retail chatter is noisy and often promotional; the app is built to be skeptical, but you make the calls.

```
apps/
  api/        NestJS + Postgres (Drizzle). Ingestion, scoring, AI research, job queue. Deploys to Railway.
  desktop/    Electron + React + TypeScript dashboard for macOS and Windows.
packages/
  shared/     Types + catalogs of AI providers and data sources shared by both.
```

## How it works

1. **Ingest** – each enabled source runs on its own interval: Reddit (official API, subreddits you choose, posts + top comments on busy threads), StockTwits trending, market data (Polygon / Finnhub / Alpha Vantage), news (Finnhub / NewsAPI) and SEC EDGAR filings (8-K, Form 4 insider trades, 10-Q…). Tickers are extracted from text and validated against SEC's list of ~10k US-listed symbols, with a stop-list for words like `ALL`, `CEO`, `YOLO`.
2. **Sweep** (default every 30 min) – mentions roll up into a daily per-ticker dataset. For each ticker the API computes mention growth vs. its 30-day baseline, acceleration, unique authors, community spread and news coverage, which give a **saturation** score and a **stage**: *Emerging → Accelerating → Crowded → Fading*.
3. **Research** – the sweep queues work in a Postgres-backed job queue, ordered by priority (your overrides win):
   - **Sentiment** (Fast model): labels posts bullish/bearish and DD / hype / promo.
   - **Deep dive** (Analyst model, plus an optional web-research model): reads the top posts, filings, news, price series and its own past calibration, then returns a 0–100 score with a breakdown, a thesis (bull/bear/catalysts), themes and a promotion-risk estimate.
   - **Position review** for everything you've marked as invested: ADD / HOLD / TRIM / SELL with confidence, stop and take-profit levels. SELL/TRIM calls trigger a desktop notification.
4. **Learn** – 7, 14 and 30 days after each signal is flagged, the API records what the stock actually did. Those outcomes are summarized (hit rate and median return by score bucket and stage) and fed back into every analyst prompt, so scoring calibrates to *your* dataset over time. Nothing is ever deleted, so the dataset keeps growing.

Everything is visible in the dashboard: what's running, what's queued, last-researched times, the model used and the cost of each job. You can pin/raise/lower/pause any ticker or job, trigger research manually, or turn autonomous mode off.

## AI models and data sources

Both are picked in **Sources & models** in the app and stored in the database (API keys encrypted with AES-256-GCM).

| AI provider | Notes |
|---|---|
| Anthropic Claude | Default recommendation for the **Analyst** role. Supports structured output via tool use and server-side web search for the **Web research** role. |
| OpenAI, Google Gemini, xAI Grok, Mistral, OpenRouter | Via OpenAI-compatible endpoints. |
| Perplexity | Web-grounded answers with citations — good for **Web research**. |
| Local (Ollama) | Self-hosted models, if the API can reach your Ollama host. |

Three roles: **Analyst** (deep dives, hold/sell advice — use your strongest model), **Fast** (high-volume classification — use a cheap model), **Web research** (optional). Press **Test** on a provider to validate the key and load its model list; enter $/M-token prices on each role so the **daily budget** cap works.

## Local development

Requirements: Node 22+, Postgres 16 (or Docker).

```bash
npm install
npm run db:up                         # Postgres via docker compose (or use your own)
cp apps/api/.env.example apps/api/.env
npm run dev:api                       # API on http://localhost:3000 (migrations run automatically)
npm run dev:desktop                   # Electron app with hot reload
```

To explore the UI before adding any keys, load fictional demo data (tickers named “(demo)”; the agent never sends them to an AI model):

```bash
npm run build:shared && npm run build -w @ff/api && npm run seed:demo -w @ff/api
npm run seed:demo -w @ff/api -- --clear    # remove it again
```

Tests: `npm test -w @ff/api`. Type-check everything: `npm run typecheck`.

## Deploy the API to Railway

1. Push this repo to GitHub and create a Railway project from it. `railway.json` and the root `Dockerfile` build only the API.
2. Add a **PostgreSQL** service to the project. Railway injects `DATABASE_URL` into the API service when you reference it (`${{Postgres.DATABASE_URL}}`).
3. Set variables on the API service:
   - `APP_API_TOKEN` – long random string (`openssl rand -hex 32`); the desktop app sends it as a bearer token.
   - `ENCRYPTION_KEY` – another `openssl rand -hex 32`. **Keep it stable**: changing it makes saved API keys unreadable (they'll show as “not set” and you re-enter them).
   - `NODE_ENV=production`
   - optional `SEC_USER_AGENT="Your Name you@example.com"` (or set it in the app under SEC EDGAR).
4. Generate a public domain for the service. Health check: `GET /health`.
5. Open the desktop app → it asks for the API URL and token on first launch (also under **Sources & models → Connection**).

Run a single replica: the job queue is replica-safe (`FOR UPDATE SKIP LOCKED`) but one instance is plenty and keeps AI spend predictable.

## Build the desktop app

```bash
npm run build:shared
npm run dist:mac -w @ff/desktop    # .dmg (arm64 + x64) — run on a Mac
npm run dist:win -w @ff/desktop    # NSIS installer — run on Windows (or CI)
```

Installers land in `apps/desktop/release/`. For distribution beyond your own machines, add code signing (Apple Developer ID + notarization, Windows certificate) in `apps/desktop/electron-builder.yml`. The API URL and token are stored in the app's user-data folder; the token is encrypted with the OS keychain via Electron `safeStorage`.

## Getting data-source credentials

- **Reddit** – create a *script* app at reddit.com/prefs/apps; paste the client ID, secret and a descriptive user agent (`finance-finder/0.1 by u/yourname`). Review Reddit's Data API terms for your use.
- **SEC EDGAR** – free, just needs a user agent with a contact email. Keep requests under 10/second (the app does).
- **Polygon / Finnhub / Alpha Vantage / NewsAPI** – free tiers work for a personal watchlist; the first enabled market source with a key (Polygon → Finnhub → Alpha Vantage) does the price syncing.

## API overview

All routes are under `/api` and need `Authorization: Bearer $APP_API_TOKEN`.

| Route | Purpose |
|---|---|
| `GET /dashboard/summary · /activity · /alerts · /heatmap` | Command Center data |
| `GET /opportunities` · `GET /opportunities/:ticker` | Ranked list and detail (series, sources, thesis, history) |
| `POST /opportunities` `{ticker}` | Track a ticker manually and queue a deep dive |
| `PUT /opportunities/:ticker/priority` · `POST /opportunities/:ticker/research` | Priority override, research now |
| `GET/POST /positions` · `POST /positions/:id/close · /review` | Portfolio |
| `GET /jobs?status=QUEUED,RUNNING` · `PUT /jobs/:id/priority` · `POST /jobs/:id/cancel · /retry` | Research queue |
| `POST /sweep` · `POST /sources/:id/run` | Manual triggers |
| `GET/PUT /settings/app` · `/settings/providers` · `/settings/roles` · `/settings/sources` | Configuration |

## Schema changes

Edit `apps/api/src/db/schema.ts`, then `npm run db:generate -w @ff/api` to write a new SQL migration into `apps/api/drizzle/`. Migrations are applied automatically on API start.
