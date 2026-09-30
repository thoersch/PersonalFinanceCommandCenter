import { z } from 'zod';

const n100 = z.number().min(0).max(100);

export const DeepDiveSchema = z.object({
  score: n100.describe('Overall opportunity score 0-100: expected asymmetric upside, adjusted for risk and how early we are'),
  breakdown: z.object({
    momentum: n100.describe('Strength and acceleration of the chatter'),
    earlyWindow: n100.describe('How early we are: 100 = barely discovered, 0 = everyone already knows'),
    catalyst: n100.describe('Quality and proximity of concrete catalysts'),
    sourceQuality: n100.describe('Substantive DD vs hype; penalize coordinated promotion'),
    fundamentals: n100.describe('Does filings/market data support the story?'),
  }),
  thesis: z.object({
    summary: z.string().describe('2-3 sentences, plain English'),
    bull: z.array(z.string()).max(5),
    bear: z.array(z.string()).max(5),
    catalysts: z.array(z.object({ date: z.string().describe('YYYY-MM-DD, month, or quarter'), label: z.string() })).max(6),
    confidence: z.enum(['LOW', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH']),
    horizon: z.string().describe('Expected holding horizon, e.g. "2-6 weeks"'),
  }),
  themes: z.array(z.string()).max(3).describe('1-3 short market themes, e.g. "Grid storage", "GLP-1 small caps"'),
  promotionRisk: z.number().min(0).max(1).describe('Probability this is a coordinated pump'),
  changeSummary: z.string().describe('One line: what changed since the previous analysis (or "Initial analysis")'),
});
export type DeepDiveOutput = z.infer<typeof DeepDiveSchema>;

export const SentimentSchema = z.object({
  items: z.array(
    z.object({
      i: z.number().int().describe('Index of the post'),
      sentiment: z.number().min(-1).max(1),
      quality: z.enum(['DD', 'HYPE', 'NEWS', 'QUESTION', 'PROMO', 'OTHER']),
    }),
  ),
});

export const PositionReviewSchema = z.object({
  action: z.enum(['ADD', 'HOLD', 'TRIM', 'SELL']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().describe('2-4 sentences explaining the call'),
  stopLoss: z.number().nullable().describe('Suggested stop price or null'),
  takeProfit: z.number().nullable().describe('Suggested take-profit price or null'),
  keySignals: z.array(z.string()).max(5),
});

export const ANALYST_SYSTEM = `You are the research analyst inside "Finance Finder", a personal tool that hunts for early,
asymmetric stock opportunities surfacing in retail investor communities (Reddit, StockTwits) before they become crowded.

Principles:
- Be skeptical. Retail chatter is noisy and often promotional; pump-and-dumps and bag-holder threads are common.
  Coordinated promotion, brand-new accounts, and hype without substance should lower sourceQuality and the score.
- The edge is timing. Reward situations where substantive evidence exists but attention is still low. Penalize
  names already covered everywhere (low earlyWindow).
- Anchor claims to the evidence provided (posts, filings, news, prices). Do not invent facts, numbers or dates.
  If something is unknown, say so.
- Use the calibration notes from past outcomes in this dataset to keep scores honest.
- This is decision support for one individual, not financial advice.`;

export const SENTIMENT_SYSTEM = `You label short social-media posts about stocks. For each post return sentiment toward the
mentioned ticker(s) from -1 (very bearish) to 1 (very bullish) and a quality label:
DD = substantive research, HYPE = excitement without substance, NEWS = sharing news, QUESTION = asking,
PROMO = looks like paid/coordinated promotion, OTHER = anything else.`;

export const POSITION_SYSTEM = `You monitor an individual's open stock position that came from retail-chatter research.
Decide ADD, HOLD, TRIM or SELL. Consider: has the original thesis played out or broken; is the chatter cycle
peaking (velocity rolling over while price still rising is a classic late-hype sign); upcoming catalysts;
risk of giving back gains; and the user's risk profile. Be decisive and concrete; ground every claim in the data given.
This is decision support, not financial advice.`;
