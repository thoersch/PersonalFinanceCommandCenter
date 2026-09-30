import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { toDto } from '../research/jobs.service';
import { OrchestratorService } from '../research/orchestrator.service';
import { PositionsService } from './positions.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const Create = z.object({
  ticker: z.string().min(1).max(10),
  quantity: z.number().positive(),
  entryPrice: z.number().positive(),
  entryDate: date,
  notes: z.string().max(2000).optional(),
});
const Close = z.object({ exitPrice: z.number().positive(), closedAt: z.string().optional() });

@Controller('positions')
export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  @Get()
  list(@Query('includeClosed') inc?: string) {
    return this.positions.list(inc === 'true');
  }

  @Post()
  async create(@Body(new ZodPipe(Create)) body: z.infer<typeof Create>) {
    const p = await this.positions.create(body);
    await this.orchestrator.reviewNow(p.id);
    return p;
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.positions.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body(new ZodPipe(Create.partial())) body: Partial<z.infer<typeof Create>>) {
    return this.positions.update(id, body);
  }

  @Post(':id/close')
  close(@Param('id') id: string, @Body(new ZodPipe(Close)) body: z.infer<typeof Close>) {
    return this.positions.close(id, body.exitPrice, body.closedAt);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.positions.remove(id);
  }

  @Get(':id/advice')
  advice(@Param('id') id: string) {
    return this.positions.adviceHistory(id);
  }

  @Post(':id/review')
  async review(@Param('id') id: string) {
    return toDto(await this.orchestrator.reviewNow(id));
  }
}
