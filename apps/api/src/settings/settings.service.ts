import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { and, eq, gte, sql } from 'drizzle-orm';
import {
  AI_PROVIDER_CATALOG,
  AI_ROLES,
  AiRole,
  AppSettingsDto,
  ProviderConfigDto,
  RoleAssignmentDto,
  SOURCE_CATALOG,
  SourceCategory,
  SourceConfigDto,
  UpdateProviderInput,
  UpdateSourceInput,
} from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { aiProviders, aiRoles, appSettings, filings, newsItems, posts, sources } from '../db/schema';
import { decrypt, decryptJson, encrypt, encryptJson, preview } from '../common/crypto';
import { hoursAgo } from '../common/http';

export const DEFAULT_APP_SETTINGS: AppSettingsDto = {
  autonomous: true,
  sweepIntervalMin: 30,
  dailyBudgetUsd: 5,
  maxDeepDivesPerSweep: 5,
  deepDiveStaleHours: 12,
  positionReviewHours: 6,
  minMentionsForSignal: 8,
  riskProfile: 'BALANCED',
  minSharePrice: null,
  maxSharePrice: null,
};

export interface ResolvedProvider {
  id: string;
  kind: 'anthropic' | 'openai-compatible';
  name: string;
  baseUrl: string;
  apiKey: string | null;
  enabled: boolean;
}

export interface ResolvedSource {
  id: string;
  enabled: boolean;
  intervalMin: number;
  options: Record<string, any>;
  credentials: Record<string, string>;
  cursor: Record<string, any>;
  lastRunAt: Date | null;
}

@Injectable()
export class SettingsService implements OnModuleInit {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Make sure every catalog entry has a row so the dashboard can list and toggle it. */
  async onModuleInit() {
    await this.db.insert(appSettings).values({ id: 1, value: DEFAULT_APP_SETTINGS }).onConflictDoNothing();
    for (const p of AI_PROVIDER_CATALOG) {
      await this.db
        .insert(aiProviders)
        .values({ id: p.id, baseUrl: p.defaultBaseUrl, enabled: false })
        .onConflictDoNothing();
    }
    for (const r of AI_ROLES) {
      await this.db.insert(aiRoles).values({ role: r.id }).onConflictDoNothing();
    }
    for (const s of SOURCE_CATALOG) {
      await this.db
        .insert(sources)
        .values({
          id: s.id,
          enabled: s.enabledByDefault,
          intervalMin: s.defaultIntervalMin,
          options: s.defaultOptions,
        })
        .onConflictDoNothing();
    }
  }

  // ---------------- App settings ----------------

  async getApp(): Promise<AppSettingsDto> {
    const row = await this.db.query.appSettings.findFirst();
    return { ...DEFAULT_APP_SETTINGS, ...(row?.value ?? {}) };
  }

  async updateApp(patch: Partial<AppSettingsDto>): Promise<AppSettingsDto> {
    const next = { ...(await this.getApp()), ...patch };
    await this.db
      .insert(appSettings)
      .values({ id: 1, value: next })
      .onConflictDoUpdate({ target: appSettings.id, set: { value: next, updatedAt: new Date() } });
    return next;
  }

  // ---------------- AI providers ----------------

  async listProviders(): Promise<ProviderConfigDto[]> {
    const rows = await this.db.select().from(aiProviders);
    return AI_PROVIDER_CATALOG.map((c) => {
      const r = rows.find((x) => x.id === c.id);
      const key = safeDecrypt(r?.apiKeyEnc);
      return {
        id: c.id,
        name: c.name,
        kind: c.kind,
        enabled: r?.enabled ?? false,
        baseUrl: r?.baseUrl ?? c.defaultBaseUrl,
        hasApiKey: !!key,
        apiKeyPreview: preview(key),
        models: r?.models ?? [],
        lastTestedAt: r?.lastTestedAt?.toISOString() ?? null,
        lastTestOk: r?.lastTestOk ?? null,
        lastTestMessage: r?.lastTestMessage ?? null,
      };
    });
  }

  async updateProvider(id: string, input: UpdateProviderInput): Promise<ProviderConfigDto> {
    const cat = AI_PROVIDER_CATALOG.find((c) => c.id === id);
    if (!cat) throw new NotFoundException(`Unknown provider ${id}`);
    const set: Partial<typeof aiProviders.$inferInsert> = { updatedAt: new Date() };
    if (input.enabled !== undefined) set.enabled = input.enabled;
    if (input.baseUrl !== undefined) set.baseUrl = input.baseUrl.trim() || cat.defaultBaseUrl;
    if (input.apiKey !== undefined) {
      set.apiKeyEnc = input.apiKey ? encrypt(input.apiKey.trim()) : null;
      set.lastTestOk = null;
      set.lastTestMessage = null;
    }
    await this.db.update(aiProviders).set(set).where(eq(aiProviders.id, id));
    return (await this.listProviders()).find((p) => p.id === id)!;
  }

  async recordProviderTest(id: string, ok: boolean, message: string, models?: string[]) {
    await this.db
      .update(aiProviders)
      .set({ lastTestedAt: new Date(), lastTestOk: ok, lastTestMessage: message, ...(models ? { models } : {}) })
      .where(eq(aiProviders.id, id));
  }

  async resolveProvider(id: string): Promise<ResolvedProvider> {
    const cat = AI_PROVIDER_CATALOG.find((c) => c.id === id);
    if (!cat) throw new NotFoundException(`Unknown provider ${id}`);
    const r = await this.db.query.aiProviders.findFirst({ where: eq(aiProviders.id, id) });
    return {
      id,
      kind: cat.kind,
      name: cat.name,
      baseUrl: r?.baseUrl ?? cat.defaultBaseUrl,
      apiKey: safeDecrypt(r?.apiKeyEnc),
      enabled: r?.enabled ?? false,
    };
  }

  // ---------------- Roles ----------------

  async listRoles(): Promise<RoleAssignmentDto[]> {
    const rows = await this.db.select().from(aiRoles);
    return AI_ROLES.map((r) => {
      const row = rows.find((x) => x.role === r.id);
      return {
        role: r.id,
        providerId: row?.providerId ?? null,
        model: row?.model ?? null,
        inputPricePerMTok: row?.inputPricePerMTok ?? null,
        outputPricePerMTok: row?.outputPricePerMTok ?? null,
      };
    });
  }

  async getRole(role: AiRole): Promise<RoleAssignmentDto> {
    return (await this.listRoles()).find((r) => r.role === role)!;
  }

  async updateRole(role: AiRole, input: Omit<RoleAssignmentDto, 'role'>): Promise<RoleAssignmentDto> {
    if (!AI_ROLES.some((r) => r.id === role)) throw new NotFoundException(`Unknown role ${role}`);
    if (input.providerId && !AI_PROVIDER_CATALOG.some((p) => p.id === input.providerId)) {
      throw new BadRequestException(`Unknown provider ${input.providerId}`);
    }
    await this.db
      .insert(aiRoles)
      .values({ role, ...input })
      .onConflictDoUpdate({ target: aiRoles.role, set: input });
    return this.getRole(role);
  }

  // ---------------- Sources ----------------

  async listSources(): Promise<SourceConfigDto[]> {
    const rows = await this.db.select().from(sources);
    const since = hoursAgo(24);
    const [postCounts, newsCounts, filingCount] = await Promise.all([
      this.db
        .select({ id: posts.sourceId, n: sql<number>`count(*)::int` })
        .from(posts)
        .where(gte(posts.fetchedAt, since))
        .groupBy(posts.sourceId),
      this.db
        .select({ id: newsItems.sourceId, n: sql<number>`count(*)::int` })
        .from(newsItems)
        .where(gte(newsItems.publishedAt, since))
        .groupBy(newsItems.sourceId),
      this.db.select({ n: sql<number>`count(*)::int` }).from(filings).where(gte(filings.filedAt, since)),
    ]);
    const counts = new Map<string, number>();
    [...postCounts, ...newsCounts].forEach((c) => counts.set(c.id, (counts.get(c.id) ?? 0) + c.n));
    counts.set('sec-edgar', filingCount[0]?.n ?? 0);

    return SOURCE_CATALOG.map((c) => {
      const r = rows.find((x) => x.id === c.id);
      const creds = decryptJson(r?.credentialsEnc);
      return {
        id: c.id,
        name: c.name,
        category: c.category,
        enabled: r?.enabled ?? c.enabledByDefault,
        intervalMin: r?.intervalMin ?? c.defaultIntervalMin,
        options: { ...c.defaultOptions, ...(r?.options ?? {}) },
        credentials: Object.fromEntries(
          c.credentialFields.map((f) => [
            f.key,
            { set: !!creds[f.key], preview: f.secret ? preview(creds[f.key]) : (creds[f.key] ?? null) },
          ]),
        ),
        lastRunAt: r?.lastRunAt?.toISOString() ?? null,
        lastRunOk: r?.lastRunOk ?? null,
        lastRunMessage: r?.lastRunMessage ?? null,
        itemsLast24h: counts.get(c.id) ?? 0,
      };
    });
  }

  async updateSource(id: string, input: UpdateSourceInput): Promise<SourceConfigDto> {
    const cat = SOURCE_CATALOG.find((c) => c.id === id);
    if (!cat) throw new NotFoundException(`Unknown source ${id}`);
    const row = await this.db.query.sources.findFirst({ where: eq(sources.id, id) });
    const set: Partial<typeof sources.$inferInsert> = {};
    if (input.enabled !== undefined) set.enabled = input.enabled;
    if (input.intervalMin !== undefined) set.intervalMin = Math.max(1, Math.round(input.intervalMin));
    if (input.options !== undefined) set.options = { ...(row?.options ?? {}), ...input.options };
    if (input.credentials) {
      const creds = decryptJson(row?.credentialsEnc);
      for (const [k, v] of Object.entries(input.credentials)) {
        if (!cat.credentialFields.some((f) => f.key === k)) continue;
        if (v === null || v === '') delete creds[k];
        else creds[k] = v.trim();
      }
      set.credentialsEnc = Object.keys(creds).length ? encryptJson(creds) : null;
    }
    if (Object.keys(set).length) await this.db.update(sources).set(set).where(eq(sources.id, id));
    return (await this.listSources()).find((s) => s.id === id)!;
  }

  async resolveSource(id: string): Promise<ResolvedSource> {
    const cat = SOURCE_CATALOG.find((c) => c.id === id);
    if (!cat) throw new NotFoundException(`Unknown source ${id}`);
    const r = await this.db.query.sources.findFirst({ where: eq(sources.id, id) });
    return {
      id,
      enabled: r?.enabled ?? cat.enabledByDefault,
      intervalMin: r?.intervalMin ?? cat.defaultIntervalMin,
      options: { ...cat.defaultOptions, ...(r?.options ?? {}) },
      credentials: decryptJson(r?.credentialsEnc),
      cursor: r?.cursor ?? {},
      lastRunAt: r?.lastRunAt ?? null,
    };
  }

  async enabledSourceIds(category?: SourceCategory): Promise<string[]> {
    const rows = await this.db.select({ id: sources.id }).from(sources).where(eq(sources.enabled, true));
    const ids = new Set(rows.map((r) => r.id));
    return SOURCE_CATALOG.filter((c) => ids.has(c.id) && (!category || c.category === category)).map((c) => c.id);
  }

  async recordSourceRun(id: string, ok: boolean, message: string, cursor?: Record<string, unknown>) {
    await this.db
      .update(sources)
      .set({ lastRunAt: new Date(), lastRunOk: ok, lastRunMessage: message.slice(0, 500), ...(cursor ? { cursor } : {}) })
      .where(and(eq(sources.id, id)));
  }
}

/** A key encrypted under a different ENCRYPTION_KEY reads as "not set" instead of crashing. */
function safeDecrypt(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}
