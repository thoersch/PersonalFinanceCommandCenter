/** fetch with timeout + JSON parsing + useful error messages. */
export async function fetchJson<T = any>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(res.status, `${res.status} ${res.statusText} from ${new URL(url).host}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response from ${new URL(url).host}: ${text.slice(0, 200)}`);
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(n: number, from = new Date()): Date {
  return new Date(from.getTime() - n * 86_400_000);
}

export function hoursAgo(n: number, from = new Date()): Date {
  return new Date(from.getTime() - n * 3_600_000);
}

/** Missing/invalid user configuration — not worth retrying until the user changes settings. */
export class ConfigError extends Error {}
