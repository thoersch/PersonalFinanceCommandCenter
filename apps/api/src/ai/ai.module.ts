import { Controller, Get, Global, Module, Param, Post } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('settings/providers')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Validates the saved key and caches the provider's model list. */
  @Post(':id/test')
  test(@Param('id') id: string) {
    return this.ai.testProvider(id);
  }

  @Get(':id/models')
  models(@Param('id') id: string) {
    return this.ai.listModels(id);
  }
}

@Global()
@Module({
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
