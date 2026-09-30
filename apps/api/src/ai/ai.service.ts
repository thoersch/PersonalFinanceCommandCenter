import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { gte, sql } from 'drizzle-orm';
import { z, ZodType } from 'zod';
import { AiRole } from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { llmUsage } from '../db/schema';
import { fetchJson } from '../common/http';
import { ResolvedProvider, SettingsService } from '../settings/settings.service';

export class BudgetExceededError extends Error {}
export class RoleNotConfiguredError extends Error {}


export interface CompletionResult<T> {
  data: T;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface RawCompletion {
  text: string;
  json?: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** Providers that accept OpenAI's `response_format: {type: "json_object"}`. */
const JSON_MODE_OK = new Set(['openai', 'google', 'xai', 'mistral', 'openrouter', 'ollama']);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  async isRoleReady(role: AiRole): Promise<boolean> {
    const r = await this.settings.getRole(role);
    if (!r.providerId || !r.model) return false;
    const p = await this.settings.resolveProvider(r.providerId);
    return p.enabled && (!!p.apiKey || p.id === 'ollama');
  }

  async spendToday(): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${llmUsage.costUsd}), 0)::float` })
      .from(llmUsage)
      .where(gte(llmUsage.createdAt, start));
    return row?.total ?? 0;
  }

  /** Structured completion validated against a zod schema. Retries once on invalid JSON. */
  async json<T>(opts: {
    role: AiRole;
    system: string;
    prompt: string;
    schema: ZodType<T>;
    maxTokens?: number;
    jobId?: string;
  }): Promise<CompletionResult<T>> {
    const { provider, model, role } = await this.resolveRole(opts.role);
    await this.assertBudget();
    const jsonSchema = z.toJSONSchema(opts.schema, { target: 'draft-7' }) as Record<string, unknown>;
    let prompt = opts.prompt;
    let totalIn = 0;
    let totalOut = 0;
    let lastErr = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await this.call(provider, model, {
        system: opts.system,
        prompt,
        maxTokens: opts.maxTokens ?? 4000,
        jsonSchema,
      });
      totalIn += raw.inputTokens;
      totalOut += raw.outputTokens;
      const candidate = raw.json ?? extractJson(raw.text);
      const parsed = opts.schema.safeParse(candidate);
      if (parsed.success) {
        const costUsd = await this.recordUsage(opts.role, provider.id, model, totalIn, totalOut, role, opts.jobId);
        return { data: parsed.data, provider: provider.id, model, inputTokens: totalIn, outputTokens: totalOut, costUsd };
      }
      lastErr = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      prompt = `${opts.prompt}\n\nYour previous reply did not match the required JSON schema (${lastErr}). Reply again with ONLY a valid JSON object.`;
    }
    await this.recordUsage(opts.role, provider.id, model, totalIn, totalOut, role, opts.jobId);
    throw new Error(`Model returned invalid JSON: ${lastErr}`);
  }

  /** Free-text completion. With WEB_RESEARCH on Anthropic, enables the server-side web search tool. */
  async text(opts: { role: AiRole; system: string; prompt: string; maxTokens?: number; jobId?: string }) {
    const { provider, model, role } = await this.resolveRole(opts.role);
    await this.assertBudget();
    const raw = await this.call(provider, model, {
      system: opts.system,
      prompt: opts.prompt,
      maxTokens: opts.maxTokens ?? 2000,
      webSearch: opts.role === 'WEB_RESEARCH',
    });
    const costUsd = await this.recordUsage(opts.role, provider.id, model, raw.inputTokens, raw.outputTokens, role, opts.jobId);
    return { text: raw.text, provider: provider.id, model, costUsd };
  }

  // ---------------- Provider management ----------------

  async listModels(providerId: string): Promise<string[]> {
    const p = await this.settings.resolveProvider(providerId);
    if (!p.apiKey && p.id !== 'ollama') throw new Error('No API key saved');
    if (p.kind === 'anthropic') {
      const res = await fetchJson<{ data: { id: string }[] }>(`${trimSlash(p.baseUrl)}/v1/models?limit=100`, {
        headers: { 'x-api-key': p.apiKey!, 'anthropic-version': '2023-06-01' },
      });
      return res.data.map((m) => m.id);
    }
    const res = await fetchJson<{ data?: { id: string }[]; models?: { name: string }[] }>(`${trimSlash(p.baseUrl)}/models`, {
      headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
    });
    const ids = res.data?.map((m) => m.id) ?? res.models?.map((m) => m.name.replace(/^models\//, '')) ?? [];
    return ids.sort();
  }

  async testProvider(providerId: string) {
    try {
      const models = await this.listModels(providerId);
      const msg = `Connected · ${models.length} models available`;
      await this.settings.recordProviderTest(providerId, true, msg, models);
      return { ok: true, message: msg, models };
    } catch (e: any) {
      // Some providers (e.g. Perplexity) have no model-listing endpoint; the key may still be fine.
      const msg = String(e?.message ?? e).slice(0, 300);
      const notListable = /404|not found/i.test(msg);
      const message = notListable ? 'This provider does not list models. Type the model name in the role settings.' : msg;
      await this.settings.recordProviderTest(providerId, notListable, message);
      return { ok: notListable, message, models: [] };
    }
  }

  // ---------------- internals ----------------

  private async resolveRole(roleId: AiRole) {
    const role = await this.settings.getRole(roleId);
    if (!role.providerId || !role.model) {
      throw new RoleNotConfiguredError(`AI role ${roleId} has no provider/model. Configure it in Sources & models.`);
    }
    const provider = await this.settings.resolveProvider(role.providerId);
    if (!provider.enabled) throw new RoleNotConfiguredError(`Provider ${provider.name} is disabled`);
    if (!provider.apiKey && provider.id !== 'ollama') throw new RoleNotConfiguredError(`Provider ${provider.name} has no API key`);
    return { provider, model: role.model, role };
  }

  private async assertBudget() {
    const app = await this.settings.getApp();
    const spent = await this.spendToday();
    if (app.dailyBudgetUsd > 0 && spent >= app.dailyBudgetUsd) {
      throw new BudgetExceededError(`Daily AI budget reached ($${spent.toFixed(2)} of $${app.dailyBudgetUsd})`);
    }
  }

  private async recordUsage(
    roleId: AiRole,
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    role: { inputPricePerMTok: number | null; outputPricePerMTok: number | null },
    jobId?: string,
  ) {
    const costUsd =
      (inputTokens / 1e6) * (role.inputPricePerMTok ?? 0) + (outputTokens / 1e6) * (role.outputPricePerMTok ?? 0);
    await this.db.insert(llmUsage).values({ role: roleId, provider, model, inputTokens, outputTokens, costUsd, jobId });
    return costUsd;
  }

  private async call(
    p: ResolvedProvider,
    model: string,
    o: { system: string; prompt: string; maxTokens: number; jsonSchema?: Record<string, unknown>; webSearch?: boolean },
  ): Promise<RawCompletion> {
    if (p.kind === 'anthropic') return this.callAnthropic(p, model, o);
    return this.callOpenAiCompatible(p, model, o);
  }

  private async callAnthropic(
    p: ResolvedProvider,
    model: string,
    o: { system: string; prompt: string; maxTokens: number; jsonSchema?: Record<string, unknown>; webSearch?: boolean },
  ): Promise<RawCompletion> {
    const client = new Anthropic({ apiKey: p.apiKey!, baseURL: p.baseUrl, maxRetries: 2, timeout: 180_000 });
    const tools: any[] = [];
    if (o.jsonSchema) {
      const { $schema, ...schema } = o.jsonSchema as any;
      tools.push({ name: 'submit', description: 'Submit the final structured answer.', input_schema: schema });
    }
    if (o.webSearch) tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 5 });
    const msg = await client.messages.create({
      model,
      max_tokens: o.maxTokens,
      system: o.system,
      messages: [{ role: 'user', content: o.prompt }],
      ...(tools.length ? { tools } : {}),
      ...(o.jsonSchema ? { tool_choice: { type: 'tool', name: 'submit' } } : {}),
    } as any);
    let text = '';
    let json: unknown;
    for (const block of msg.content as any[]) {
      if (block.type === 'text') text += block.text;
      if (block.type === 'tool_use' && block.name === 'submit') json = block.input;
    }
    return { text, json, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens };
  }

  private async callOpenAiCompatible(
    p: ResolvedProvider,
    model: string,
    o: { system: string; prompt: string; maxTokens: number; jsonSchema?: Record<string, unknown> },
  ): Promise<RawCompletion> {
    const system = o.jsonSchema
      ? `${o.system}\n\nRespond with ONLY a JSON object matching this JSON Schema, no prose, no code fences:\n${JSON.stringify(o.jsonSchema)}`
      : o.system;
    const body: Record<string, unknown> = {
      model,
      max_tokens: o.maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: o.prompt },
      ],
    };
    if (o.jsonSchema && JSON_MODE_OK.has(p.id)) body.response_format = { type: 'json_object' };
    const res = await fetchJson<any>(`${trimSlash(p.baseUrl)}/chat/completions`, {
      method: 'POST',
      timeoutMs: 180_000,
      headers: {
        'Content-Type': 'application/json',
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
        ...(p.id === 'openrouter' ? { 'X-Title': 'Finance Finder' } : {}),
      },
      body: JSON.stringify(body),
    });
    const text: string = res.choices?.[0]?.message?.content ?? '';
    const citations: string[] = res.citations ?? [];
    return {
      text: citations.length ? `${text}\n\nSources:\n${citations.map((c) => `- ${c}`).join('\n')}` : text,
      inputTokens: res.usage?.prompt_tokens ?? 0,
      outputTokens: res.usage?.completion_tokens ?? 0,
    };
  }
}

function trimSlash(s: string) {
  return s.replace(/\/+$/, '');
}

/** Pull the first JSON object out of a model reply (handles code fences and leading prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf('{');
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
