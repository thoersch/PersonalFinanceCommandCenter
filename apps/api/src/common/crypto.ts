import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM for secrets stored in Postgres (provider API keys, source credentials).
 * Key comes from ENCRYPTION_KEY (hex or base64, 32 bytes). Any other string is hashed to 32 bytes.
 */
function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') throw new Error('ENCRYPTION_KEY must be set in production');
    return createHash('sha256').update('finance-finder-dev-only-key').digest();
  }
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const b64 = Buffer.from(raw, 'base64');
  if (b64.length === 32) return b64;
  return createHash('sha256').update(raw).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptJson(obj: Record<string, string>): string {
  return encrypt(JSON.stringify(obj));
}

export function decryptJson(payload: string | null | undefined): Record<string, string> {
  if (!payload) return {};
  try {
    return JSON.parse(decrypt(payload));
  } catch {
    return {};
  }
}

/** "sk-ant-abc…9f2a" style preview that never reveals the whole secret. */
export function preview(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 8) return '••••';
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}
