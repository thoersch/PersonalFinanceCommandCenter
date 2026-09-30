/**
 * Pulls stock tickers out of social text.
 *  - Cashtags ($GME) are trusted when the symbol exists.
 *  - Bare uppercase words (GME) are only accepted when the symbol exists AND is not a
 *    common word/acronym that happens to be a ticker (ALL, CEO, YOLO, DD, ...).
 */

const STOPWORDS = new Set(
  `A I AM AN AND ANY ARE AS AT BE BIG BY CAN CEO CFO COO CTO DD DO EOD EOW EPS ETF ETFS EV FOR FOMO FUD GDP GO HAS HE
  HOLD IF IMO IMHO IN IPO IRA IS IT ITS ITM OTM ATM ME MY NEW NO NOT NOW OF OK ON ONE OR OUT PM AM PT RH SEC SO THE TO
  UP US USA USD WE WSB YOLO LOL LMAO TLDR TL DR ATH ATL AH PR Q1 Q2 Q3 Q4 FY YOY QOQ API AI ML IV DTE OP EDIT UPDATE
  BUY SELL CALL CALLS PUT PUTS LONG SHORT BULL BEAR MOON APE APES HODL GAIN GAINS LOSS LOSSES CASH DEBT RIP GG
  NYSE NASDAQ OTC FDA FED CPI PPI JOBS SPAC LEAPS LEAP RSI MACD EMA SMA VWAP PE PEG ROI ROE EBIT EBITDA FCF NAV
  ALL ARE BEST BIT CAR CARS COST DIS EDGE EYE FAST FOR FUN GOOD HAS HOPE HUGE JUST KEY LIFE LOVE LOW MAN MOST NICE
  NEXT ONLY OPEN PLAY REAL RUN SAFE SEE SHE TRUE TWO VERY WELL WAY WHO WIN YOU ANY BRO DUDE BOTH CASH FREE HEAR
  UK EU UN NATO CNBC WSJ NYT BBC CNN IRS DOJ FTC ETH BTC NFT USDT OG GOAT IQ TV PC OS UI UX LLC INC CO LTD ESG`
    .split(/\s+/)
    .filter(Boolean),
);

const CASHTAG = /\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)\b/g;
const BARE = /\b([A-Z]{2,5})\b/g;

export function extractTickers(text: string, valid: Set<string>): string[] {
  if (!text) return [];
  const found = new Set<string>();
  // With no ticker universe loaded yet (SEC unreachable), fall back to trusting cashtags.
  const permissive = valid.size === 0;
  for (const m of text.matchAll(CASHTAG)) {
    const t = m[1].toUpperCase();
    if (valid.has(t) || (permissive && t.length >= 2 && !STOPWORDS.has(t))) found.add(t);
  }
  for (const m of text.matchAll(BARE)) {
    const t = m[1];
    if (!STOPWORDS.has(t) && valid.has(t)) found.add(t);
  }
  return [...found];
}
