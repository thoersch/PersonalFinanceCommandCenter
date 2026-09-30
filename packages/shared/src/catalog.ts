/**
 * Catalogs of the AI providers and data sources the user can turn on from the
 * dashboard. The API seeds a config row for every entry; the user's choices
 * (enabled flag, keys, models, options) are stored in Postgres.
 */

export type AiProviderKind = 'anthropic' | 'openai-compatible';

export interface AiProviderCatalogEntry {
  id: string;
  name: string;
  kind: AiProviderKind;
  defaultBaseUrl: string;
  keyRequired: boolean;
  docsUrl: string;
  description: string;
  /** Roles this provider is typically good at. Purely a hint for the UI. */
  goodFor: AiRole[];
}

export type AiRole = 'ANALYST' | 'FAST' | 'WEB_RESEARCH';

export const AI_ROLES: { id: AiRole; name: string; description: string }[] = [
  {
    id: 'ANALYST',
    name: 'Analyst',
    description: 'Deep dives, scoring, theses and hold/sell advice. Use your strongest reasoning model.',
  },
  {
    id: 'FAST',
    name: 'Fast classifier',
    description: 'High-volume work: sentiment, DD-vs-hype and promotion detection on individual posts.',
  },
  {
    id: 'WEB_RESEARCH',
    name: 'Web research',
    description: 'Optional. A web-grounded model that pulls fresh context from the open web during deep dives.',
  },
];

export const AI_PROVIDER_CATALOG: AiProviderCatalogEntry[] = [
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyRequired: true,
    docsUrl: 'https://docs.claude.com/en/docs/about-claude/models',
    description: 'Strong long-context reasoning; a good default for the Analyst role.',
    goodFor: ['ANALYST', 'FAST'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyRequired: true,
    docsUrl: 'https://platform.openai.com/docs/models',
    description: 'GPT family models.',
    goodFor: ['ANALYST', 'FAST'],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyRequired: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/models',
    description: 'Gemini models via the OpenAI-compatible endpoint.',
    goodFor: ['ANALYST', 'FAST'],
  },
  {
    id: 'xai',
    name: 'xAI Grok',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.x.ai/v1',
    keyRequired: true,
    docsUrl: 'https://docs.x.ai/docs/models',
    description: 'Grok models.',
    goodFor: ['ANALYST', 'FAST'],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.perplexity.ai',
    keyRequired: true,
    docsUrl: 'https://docs.perplexity.ai/getting-started/models',
    description: 'Web-grounded answers with citations; best fit for the Web research role.',
    goodFor: ['WEB_RESEARCH'],
  },
  {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    keyRequired: true,
    docsUrl: 'https://docs.mistral.ai/getting-started/models/',
    description: 'Mistral models; inexpensive option for the Fast role.',
    goodFor: ['FAST'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyRequired: true,
    docsUrl: 'https://openrouter.ai/models',
    description: 'One key for many vendors; handy for trying models side by side.',
    goodFor: ['ANALYST', 'FAST'],
  },
  {
    id: 'ollama',
    name: 'Local (Ollama)',
    kind: 'openai-compatible',
    defaultBaseUrl: 'http://localhost:11434/v1',
    keyRequired: false,
    docsUrl: 'https://ollama.com/library',
    description: 'Self-hosted open models. Only reachable if the API can see the Ollama host.',
    goodFor: ['FAST'],
  },
];

export type SourceCategory = 'SOCIAL' | 'MARKET' | 'NEWS' | 'FILINGS';

export interface CredentialField {
  key: string;
  label: string;
  secret: boolean;
  optional?: boolean;
}

export interface SourceCatalogEntry {
  id: string;
  name: string;
  category: SourceCategory;
  description: string;
  signupUrl: string;
  credentialFields: CredentialField[];
  /** Default polling interval in minutes. */
  defaultIntervalMin: number;
  defaultOptions: Record<string, unknown>;
  enabledByDefault: boolean;
}

export const DEFAULT_SUBREDDITS = [
  'wallstreetbets',
  'stocks',
  'investing',
  'options',
  'pennystocks',
  'StockMarket',
  'smallstreetbets',
  'SecurityAnalysis',
  'ValueInvesting',
  'Daytrading',
  'biotechplays',
  'shortsqueeze',
];

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  {
    id: 'reddit',
    name: 'Reddit',
    category: 'SOCIAL',
    description: 'Posts and top comments from the subreddits you pick, via the official Reddit API.',
    signupUrl: 'https://www.reddit.com/prefs/apps',
    credentialFields: [
      { key: 'clientId', label: 'Client ID', secret: false },
      { key: 'clientSecret', label: 'Client secret', secret: true },
      { key: 'userAgent', label: 'User agent (e.g. finance-finder/0.1 by u/you)', secret: false },
    ],
    defaultIntervalMin: 10,
    defaultOptions: { subreddits: DEFAULT_SUBREDDITS.slice(0, 8), postsPerSub: 100, commentsPerPost: 20 },
    enabledByDefault: true,
  },
  {
    id: 'stocktwits',
    name: 'StockTwits',
    category: 'SOCIAL',
    description: 'Trending symbols stream. Public endpoints; availability varies.',
    signupUrl: 'https://api.stocktwits.com/developers',
    credentialFields: [],
    defaultIntervalMin: 15,
    defaultOptions: {},
    enabledByDefault: false,
  },
  {
    id: 'polygon',
    name: 'Polygon.io (Massive)',
    category: 'MARKET',
    description: 'Daily bars, previous close and ticker details.',
    signupUrl: 'https://polygon.io/dashboard/signup',
    credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
    defaultIntervalMin: 30,
    defaultOptions: { baseUrl: 'https://api.polygon.io' },
    enabledByDefault: false,
  },
  {
    id: 'finnhub',
    name: 'Finnhub',
    category: 'MARKET',
    description: 'Real-time quotes and company profiles (free tier available). Also provides company news.',
    signupUrl: 'https://finnhub.io/register',
    credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
    defaultIntervalMin: 15,
    defaultOptions: {},
    enabledByDefault: false,
  },
  {
    id: 'alphavantage',
    name: 'Alpha Vantage',
    category: 'MARKET',
    description: 'Daily price series. Free tier is heavily rate-limited.',
    signupUrl: 'https://www.alphavantage.co/support/#api-key',
    credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
    defaultIntervalMin: 60,
    defaultOptions: {},
    enabledByDefault: false,
  },
  {
    id: 'finnhub-news',
    name: 'Finnhub company news',
    category: 'NEWS',
    description: 'Per-ticker news headlines. Uses the Finnhub key.',
    signupUrl: 'https://finnhub.io/register',
    credentialFields: [{ key: 'apiKey', label: 'API key (blank = reuse Finnhub market key)', secret: true, optional: true }],
    defaultIntervalMin: 60,
    defaultOptions: { lookbackDays: 7 },
    enabledByDefault: false,
  },
  {
    id: 'newsapi',
    name: 'NewsAPI',
    category: 'NEWS',
    description: 'Headlines search across publishers.',
    signupUrl: 'https://newsapi.org/register',
    credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
    defaultIntervalMin: 60,
    defaultOptions: { lookbackDays: 7 },
    enabledByDefault: false,
  },
  {
    id: 'sec-edgar',
    name: 'SEC EDGAR',
    category: 'FILINGS',
    description: 'Free. 8-K, 10-Q/10-K, Form 4 insider trades and more. SEC requires a contact email in the user agent.',
    signupUrl: 'https://www.sec.gov/os/accessing-edgar-data',
    credentialFields: [{ key: 'userAgent', label: 'User agent (e.g. "Finance Finder you@example.com")', secret: false }],
    defaultIntervalMin: 60,
    defaultOptions: { forms: ['8-K', '4', '10-Q', '10-K', 'S-1', 'SC 13D', 'SC 13G'] },
    enabledByDefault: true,
  },
];
