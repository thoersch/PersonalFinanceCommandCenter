import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { JobStatus, PRIORITIES } from '@ff/shared';
import { ZodPipe } from '../common/zod.pipe';
import { JobsService, toDto } from './jobs.service';
import { OrchestratorService } from './orchestrator.service';

const PriorityBody = z.object({ priority: z.enum(PRIORITIES as [string, ...string[]]) });

@Controller()
export class ResearchController {
  constructor(
    private readonly jobs: JobsService,
    private readonly orchestrator: OrchestratorService,
  ) {}

  @Get('jobs')
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    const st = status ? (status.split(',') as JobStatus[]) : undefined;
    return this.jobs.list(st, Math.min(Number(limit) || 100, 500));
  }

  @Put('jobs/:id/priority')
  priority(@Param('id') id: string, @Body(new ZodPipe(PriorityBody)) body: z.infer<typeof PriorityBody>) {
    return this.jobs.setOverride(id, body.priority as any);
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.jobs.cancel(id);
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string) {
    return this.jobs.retry(id);
  }

  @Post('sweep')
  async sweep() {
    await this.orchestrator.sweepNow();
    return { ok: true };
  }

  @Post('sources/:id/run')
  async runSource(@Param('id') id: string) {
    return toDto(await this.orchestrator.ingestNow(id));
  }
}
