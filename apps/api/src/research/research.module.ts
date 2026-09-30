import { Global, Module } from '@nestjs/common';
import { SignalsService } from '../signals/signals.service';
import { JobsService } from './jobs.service';
import { OrchestratorService } from './orchestrator.service';
import { OutcomesService } from './outcomes.service';
import { ResearchController } from './research.controller';
import { ResearchService } from './research.service';

@Global()
@Module({
  controllers: [ResearchController],
  providers: [JobsService, OrchestratorService, OutcomesService, ResearchService, SignalsService],
  exports: [JobsService, OrchestratorService, OutcomesService],
})
export class ResearchModule {}
