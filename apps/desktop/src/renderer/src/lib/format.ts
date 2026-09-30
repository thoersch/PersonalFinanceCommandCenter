export function pct(v: number | null | undefined, digits = 1, sign = true): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const s = (v * 100).toFixed(digits);
  return `${sign && v > 0 ? '+' : ''}${s.replace('-', '−')}%`;
}

export function money(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const abs = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${v < 0 ? '−' : ''}$${abs}`;
}

export function signedMoney(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return '—';
  return `${v >= 0 ? '+' : ''}${money(v, digits)}`;
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return inTime(iso);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function inTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return 'now';
  if (s < 3600) return `in ${Math.ceil(s / 60)}m`;
  if (s < 86400) return `in ${Math.round(s / 3600)}h`;
  return `in ${Math.round(s / 86400)}d`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const tone = (v: number | null | undefined) => (v === null || v === undefined ? 'muted' : v >= 0 ? 'up' : 'down');

export const growthLabel = (g: number | null) => (g === null ? '—' : pct(g, 0));

export const STAGE_LABEL = { EMERGING: 'Emerging', ACCELERATING: 'Accelerating', CROWDED: 'Crowded', FADING: 'Fading' } as const;
export const PRIORITY_LABEL = { PINNED: 'Pinned', HIGH: 'High', AUTO: 'Auto', LOW: 'Low', PAUSED: 'Paused' } as const;
export const JOB_LABEL: Record<string, string> = {
  INGEST: 'Ingest',
  AGGREGATE: 'Sweep',
  SENTIMENT: 'Sentiment',
  DEEP_DIVE: 'Deep dive',
  POSITION_REVIEW: 'Position review',
  OUTCOME_LABEL: 'Learning',
};
