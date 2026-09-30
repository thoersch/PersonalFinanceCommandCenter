import type { AiProviderKind, AiRole, SourceCategory } from './catalog';

export type Stage = 'EMERGING' | 'ACCELERATING' | 'CROWDED' | 'FADING';
export type Priority = 'PINNED' | 'HIGH' | 'AUTO' | 'LOW' | 'PAUSED';
export type AdviceAction = 'ADD' | 'HOLD' | 'TRIM' | 'SELL';
export type JobType =
  | 'INGEST'
  | 'AGGREGATE'
  | 'SENTIMENT'
  | 'DEEP_DIVE'
  | 'POSITION_REVIEW'
  | 'OUTCOME_LABEL';
export type JobStatus = 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';

export const STAGES: Stage[] = ['EMERGING', 'ACCELERATING', 'CROWDED', 'FADING'];
export const PRIORITIES: Priority[] = ['PINNED', 'HIGH', 'AUTO', 'LOW', 'PAUSED'];

export interface ScoreBreakdown {
  momentum: number; // chatter acceleration
  earlyWindow: number; // inverse of saturation
  catalyst: number; // proximity/quality of catalysts
  sourceQuality: number; // DD vs hype, promo detection
  fundamentals: number; // sanity check against filings/market data
}

export interface Thesis {
  summary: string;
  bull: string[];
  bear: string[];
  catalysts: { date: string; label: string }[];
  confidence: 'LOW' | 'MEDIUM' | 'MEDIUM_HIGH' | 'HIGH';
  horizon: string;
}

export interface OpportunityListItem {
  id: string;
  ticker: string;
  name: string | null;
  score: number | null;
  stage: Stage;
  saturation: number; // 0..1
  mentions24h: number;
  mentions7d: number;
  mentionGrowth7d: number | null; // ratio vs baseline, e.g. 4.12 = +412%
  uniqueAuthors7d: number;
  sentiment: number | null; // -1..1
  sparkline: number[]; // daily mentions, oldest first
  price: number | null;
  change1d: number | null; // fraction
  lastResearchedAt: string | null;
  firstFlaggedAt: string;
  priority: Priority;
  effectivePriority: number;
  isHeld: boolean;
  watch: boolean;
}

export interface SourceItemDto {
  id: string;
  kind: 'POST' | 'NEWS' | 'FILING';
  source: string; // r/wallstreetbets, SEC EDGAR, Reuters...
  title: string;
  url: string | null;
  publishedAt: string;
  meta: string;
  tag: string | null; // DD, Hype, Insider buy...
}

export interface AnalysisDto {
  id: string;
  createdAt: string;
  kind: JobType;
  provider: string;
  model: string;
  score: number | null;
  previousScore: number | null;
  summary: string;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  close: number | null;
  mentions: number;
}

export interface OpportunityDetail extends OpportunityListItem {
  breakdown: ScoreBreakdown | null;
  thesis: Thesis | null;
  series: DailyPoint[];
  sources: SourceItemDto[];
  history: AnalysisDto[];
  nextResearchAt: string | null;
  exchange: string | null;
  sector: string | null;
}

export interface PositionDto {
  id: string;
  ticker: string;
  name: string | null;
  quantity: number;
  entryPrice: number;
  entryDate: string;
  notes: string | null;
  closedAt: string | null;
  exitPrice: number | null;
  price: number | null;
  marketValue: number | null;
  pnl: number | null;
  pnlPct: number | null;
  advice: {
    action: AdviceAction;
    confidence: number; // 0..1
    rationale: string;
    stopLoss: number | null;
    takeProfit: number | null;
    createdAt: string;
  } | null;
  opportunityId: string | null;
}

export interface CreatePositionInput {
  ticker: string;
  quantity: number;
  entryPrice: number;
  entryDate: string;
  notes?: string;
}

export interface ResearchJobDto {
  id: string;
  type: JobType;
  status: JobStatus;
  target: string | null; // ticker or source id
  priority: number;
  priorityOverride: Priority | null;
  progress: number; // 0..1
  message: string | null;
  provider: string | null;
  model: string | null;
  costUsd: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  runAfter: string;
  error: string | null;
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: string;
  status: JobStatus;
  text: string;
}

export interface HeatmapDto {
  themes: string[];
  sources: string[];
  /** growth ratio vs baseline, rows = sources, cols = themes */
  values: (number | null)[][];
}

export interface DashboardSummary {
  activeSignals: number;
  newSignalsToday: number;
  earlyWindow: number;
  openPositions: number;
  unrealizedPnl: number | null;
  jobsRunning: number;
  jobsQueued: number;
  lastSweepAt: string | null;
  nextSweepAt: string | null;
  autonomous: boolean;
  spendTodayUsd: number;
  dailyBudgetUsd: number;
  datasetStats: { posts: number; mentions: number; tickers: number; labeledOutcomes: number; hitRate30d: number | null };
}

export interface PositionAlert {
  positionId: string;
  ticker: string;
  action: AdviceAction;
  pnlPct: number | null;
  rationale: string;
}

// ---- Settings ----

export interface ProviderConfigDto {
  id: string; // catalog id
  name: string;
  kind: AiProviderKind;
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyPreview: string | null; // e.g. "sk-…9f2a"
  models: string[]; // cached from /models
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
}

export interface UpdateProviderInput {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string | null; // null clears
}

export interface RoleAssignmentDto {
  role: AiRole;
  providerId: string | null;
  model: string | null;
  inputPricePerMTok: number | null;
  outputPricePerMTok: number | null;
}

export interface SourceConfigDto {
  id: string;
  name: string;
  category: SourceCategory;
  enabled: boolean;
  intervalMin: number;
  options: Record<string, unknown>;
  credentials: Record<string, { set: boolean; preview: string | null }>;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  lastRunMessage: string | null;
  itemsLast24h: number;
}

export interface UpdateSourceInput {
  enabled?: boolean;
  intervalMin?: number;
  options?: Record<string, unknown>;
  credentials?: Record<string, string | null>;
}

export interface AppSettingsDto {
  autonomous: boolean;
  sweepIntervalMin: number;
  dailyBudgetUsd: number;
  maxDeepDivesPerSweep: number;
  deepDiveStaleHours: number;
  positionReviewHours: number;
  minMentionsForSignal: number;
  riskProfile: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}
