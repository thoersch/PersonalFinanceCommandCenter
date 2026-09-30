import { Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, isNotNull } from 'drizzle-orm';
import { AdviceAction, CreatePositionInput, PositionDto } from '@ff/shared';
import { Db, InjectDb } from '../db/db.module';
import { advice, opportunities, positions, tickerDaily } from '../db/schema';
import { TickersService } from '../ingest/tickers.service';
import { OpportunitiesService } from '../opportunities/opportunities.service';

type PosRow = typeof positions.$inferSelect;

@Injectable()
export class PositionsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly tickers: TickersService,
    private readonly opps: OpportunitiesService,
  ) {}

  async list(includeClosed = false): Promise<PositionDto[]> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(includeClosed ? undefined : isNull(positions.closedAt))
      .orderBy(desc(positions.createdAt));
    return this.toDtos(rows);
  }

  async get(id: string): Promise<PositionDto> {
    const row = await this.db.query.positions.findFirst({ where: eq(positions.id, id) });
    if (!row) throw new NotFoundException();
    return (await this.toDtos([row]))[0];
  }

  async create(input: CreatePositionInput): Promise<PositionDto> {
    const ticker = input.ticker.toUpperCase().trim();
    // Make sure the research engine is following anything the user owns.
    await this.opps.track(ticker, 'AUTO').catch(() => undefined);
    const [row] = await this.db
      .insert(positions)
      .values({ ticker, quantity: input.quantity, entryPrice: input.entryPrice, entryDate: input.entryDate, notes: input.notes ?? null })
      .returning();
    return this.get(row.id);
  }

  async update(id: string, patch: Partial<CreatePositionInput>) {
    const set: Partial<typeof positions.$inferInsert> = {};
    if (patch.quantity !== undefined) set.quantity = patch.quantity;
    if (patch.entryPrice !== undefined) set.entryPrice = patch.entryPrice;
    if (patch.entryDate !== undefined) set.entryDate = patch.entryDate;
    if (patch.notes !== undefined) set.notes = patch.notes;
    const [row] = await this.db.update(positions).set(set).where(eq(positions.id, id)).returning();
    if (!row) throw new NotFoundException();
    return this.get(id);
  }

  async close(id: string, exitPrice: number, closedAt?: string) {
    const [row] = await this.db
      .update(positions)
      .set({ exitPrice, closedAt: closedAt ? new Date(closedAt) : new Date() })
      .where(eq(positions.id, id))
      .returning();
    if (!row) throw new NotFoundException();
    return this.get(id);
  }

  async remove(id: string) {
    await this.db.delete(positions).where(eq(positions.id, id));
    return { ok: true };
  }

  async adviceHistory(id: string) {
    return this.db.select().from(advice).where(eq(advice.positionId, id)).orderBy(desc(advice.createdAt)).limit(50);
  }

  private async latestPrices(tick: string[]) {
    const map = new Map<string, number>();
    if (!tick.length) return map;
    const opp = await this.db
      .select({ t: opportunities.ticker, p: opportunities.price })
      .from(opportunities)
      .where(and(inArray(opportunities.ticker, tick), isNotNull(opportunities.price)));
    opp.forEach((o) => o.p !== null && map.set(o.t, o.p));
    const missing = tick.filter((t) => !map.has(t));
    for (const t of missing) {
      const [d] = await this.db
        .select({ c: tickerDaily.close })
        .from(tickerDaily)
        .where(and(eq(tickerDaily.ticker, t), isNotNull(tickerDaily.close)))
        .orderBy(desc(tickerDaily.day))
        .limit(1);
      if (d?.c) map.set(t, d.c);
    }
    return map;
  }

  async toDtos(rows: PosRow[]): Promise<PositionDto[]> {
    if (!rows.length) return [];
    const tick = [...new Set(rows.map((r) => r.ticker))];
    const [prices, info, oppRows, adv] = await Promise.all([
      this.latestPrices(tick),
      this.tickers.info(tick),
      this.db.select({ id: opportunities.id, t: opportunities.ticker }).from(opportunities).where(inArray(opportunities.ticker, tick)),
      this.db
        .selectDistinctOn([advice.positionId])
        .from(advice)
        .where(inArray(advice.positionId, rows.map((r) => r.id)))
        .orderBy(advice.positionId, desc(advice.createdAt)),
    ]);
    const oppMap = new Map(oppRows.map((o) => [o.t, o.id]));
    const advMap = new Map(adv.map((a) => [a.positionId, a]));
    return rows.map((r) => {
      const price = r.closedAt ? r.exitPrice : (prices.get(r.ticker) ?? null);
      const a = advMap.get(r.id);
      return {
        id: r.id,
        ticker: r.ticker,
        name: info.get(r.ticker)?.name ?? null,
        quantity: r.quantity,
        entryPrice: r.entryPrice,
        entryDate: r.entryDate,
        notes: r.notes,
        closedAt: r.closedAt?.toISOString() ?? null,
        exitPrice: r.exitPrice,
        price,
        marketValue: price !== null ? price * r.quantity : null,
        pnl: price !== null ? (price - r.entryPrice) * r.quantity : null,
        pnlPct: price !== null ? price / r.entryPrice - 1 : null,
        advice: a
          ? {
              action: a.action as AdviceAction,
              confidence: a.confidence,
              rationale: a.rationale,
              stopLoss: a.stopLoss,
              takeProfit: a.takeProfit,
              createdAt: a.createdAt.toISOString(),
            }
          : null,
        opportunityId: oppMap.get(r.ticker) ?? null,
      };
    });
  }
}
