import { Body, Controller, Get, Param, Patch, Put } from '@nestjs/common';
import { z } from 'zod';
import { AI_PROVIDER_CATALOG, AI_ROLES, AiRole, SOURCE_CATALOG } from '@ff/shared';
import { ZodPipe } from '../common/zod.pipe';
import { SettingsService } from './settings.service';

const AppSettingsPatch = z
  .object({
    autonomous: z.boolean(),
    sweepIntervalMin: z.number().int().min(5).max(24 * 60),
    dailyBudgetUsd: z.number().min(0).max(10_000),
    maxDeepDivesPerSweep: z.number().int().min(0).max(100),
    deepDiveStaleHours: z.number().min(1).max(24 * 14),
    positionReviewHours: z.number().min(1).max(24 * 14),
    minMentionsForSignal: z.number().int().min(1).max(10_000),
    riskProfile: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
  })
  .partial();

const ProviderPatch = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(1000).nullable().optional(),
});

const RolePut = z.object({
  providerId: z.string().nullable(),
  model: z.string().max(200).nullable(),
  inputPricePerMTok: z.number().min(0).nullable(),
  outputPricePerMTok: z.number().min(0).nullable(),
});

const SourcePatch = z.object({
  enabled: z.boolean().optional(),
  intervalMin: z.number().min(1).max(24 * 60).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  credentials: z.record(z.string(), z.string().max(2000).nullable()).optional(),
});

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('catalog')
  catalog() {
    return { providers: AI_PROVIDER_CATALOG, roles: AI_ROLES, sources: SOURCE_CATALOG };
  }

  @Get('app')
  getApp() {
    return this.settings.getApp();
  }

  @Put('app')
  updateApp(@Body(new ZodPipe(AppSettingsPatch)) body: z.infer<typeof AppSettingsPatch>) {
    return this.settings.updateApp(body);
  }

  @Get('providers')
  providers() {
    return this.settings.listProviders();
  }

  @Patch('providers/:id')
  updateProvider(@Param('id') id: string, @Body(new ZodPipe(ProviderPatch)) body: z.infer<typeof ProviderPatch>) {
    return this.settings.updateProvider(id, body);
  }

  @Get('roles')
  roles() {
    return this.settings.listRoles();
  }

  @Put('roles/:role')
  updateRole(@Param('role') role: AiRole, @Body(new ZodPipe(RolePut)) body: z.infer<typeof RolePut>) {
    return this.settings.updateRole(role, body);
  }

  @Get('sources')
  sources() {
    return this.settings.listSources();
  }

  @Patch('sources/:id')
  updateSource(@Param('id') id: string, @Body(new ZodPipe(SourcePatch)) body: z.infer<typeof SourcePatch>) {
    return this.settings.updateSource(id, body);
  }
}
