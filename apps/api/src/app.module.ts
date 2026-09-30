import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AiModule } from './ai/ai.module';
import { TokenGuard } from './common/auth.guard';
import { DashboardController } from './dashboard/dashboard.controller';
import { DbModule } from './db/db.module';
import { IngestModule } from './ingest/ingest.module';
import { OpportunitiesController } from './opportunities/opportunities.controller';
import { OpportunitiesService } from './opportunities/opportunities.service';
import { PositionsController } from './positions/positions.controller';
import { PositionsService } from './positions/positions.service';
import { ResearchModule } from './research/research.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [DbModule, SettingsModule, AiModule, IngestModule, ResearchModule],
  controllers: [OpportunitiesController, PositionsController, DashboardController],
  providers: [OpportunitiesService, PositionsService, { provide: APP_GUARD, useClass: TokenGuard }],
})
export class AppModule {}
