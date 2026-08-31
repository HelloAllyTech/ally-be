import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { PromptModule } from '../prompt/prompt.module';
import { LlmUsageModule } from '../analytics/llm-usage.module';
import { MobileReleaseWhatsNewAiService } from './mobile-release-whats-new-ai.service';
import { MobileReleasesController } from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';

@Module({
  imports: [AppConfigModule, PromptModule, LlmUsageModule],
  controllers: [MobileReleasesController],
  providers: [MobileReleasesService, MobileReleaseWhatsNewAiService],
  exports: [MobileReleasesService],
})
export class MobileReleasesModule {}
