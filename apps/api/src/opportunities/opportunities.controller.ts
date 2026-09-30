import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { PRIORITIES, Priority, Stage, STAGES } from '@ff/shared';
import { ZodPipe } from '../common/zod.pipe';
import { toDto } from '../research/jobs.service';
import { OrchestratorService } from '../research/orchestrator.service';
import { OpportunitiesService } from './opportunities.service';

const PriorityBody = z.object({ priority: z.enum(PRIORITIES as [Priority, ...Priority[]]) });
const PatchBody = z.object({ watch: z.boolean().optional(), dismissed: z.boolean().optional() });
const TrackBody = z.object({
  ticker: z.string().min(1).max(10),
  priority: z.enum(PRIORITIES as [Priority, ...Priority[]]).optional(),
});

@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly opps: OpportunitiesService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  @Get()
  list(@Query('stage') stage?: string, @Query('q') q?: string, @Query('includeDismissed') inc?: string, @Query('limit') limit?: string) {
    return this.opps.list({
      stage: STAGES.includes(stage as Stage) ? (stage as Stage) : undefined,
      q: q || undefined,
      includeDismissed: inc === 'true',
      limit: Number(limit) || undefined,
    });
  }

  @Post()
  async track(@Body(new ZodPipe(TrackBody)) body: z.infer<typeof TrackBody>) {
    const opp = await this.opps.track(body.ticker, body.priority);
    await this.orchestrator.researchNow(opp.ticker);
    return this.opps.detail(opp.ticker);
  }

  @Get(':ticker')
  detail(@Param('ticker') ticker: string) {
    return this.opps.detail(ticker);
  }

  @Put(':ticker/priority')
  priority(@Param('ticker') ticker: string, @Body(new ZodPipe(PriorityBody)) body: z.infer<typeof PriorityBody>) {
    return this.opps.setPriority(ticker, body.priority);
  }

  @Patch(':ticker')
  patch(@Param('ticker') ticker: string, @Body(new ZodPipe(PatchBody)) body: z.infer<typeof PatchBody>) {
    return this.opps.patch(ticker, body);
  }

  @Post(':ticker/research')
  async research(@Param('ticker') ticker: string) {
    return toDto(await this.orchestrator.researchNow(ticker.toUpperCase()));
  }
}
