import { Module } from '@nestjs/common';
import { AppVersionModule } from '../app-version/app-version.module';
import { AppConfigModule } from '../config/config.module';
import { NotificationModule } from '../notification/notification.module';
import { PromptModule } from '../prompt/prompt.module';
import { LlmUsageModule } from '../analytics/llm-usage.module';
import { AndroidMinVersionAutoBumpSchedulerRegistrationService } from './android-min-version-auto-bump-scheduler-registration.service';
import { IosMinVersionAutoBumpSchedulerRegistrationService } from './ios-min-version-auto-bump-scheduler-registration.service';
import { MobileReleaseWhatsNewAiService } from './mobile-release-whats-new-ai.service';
import { MobileReleasesController } from './mobile-releases.controller';
import { MobileReleasesService } from './mobile-releases.service';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';

@Module({
  imports: [
    AppConfigModule,
    PromptModule,
    LlmUsageModule,
    LlmAgentModule,
    AppVersionModule,
    NotificationModule,
  ],
  controllers: [MobileReleasesController],
  providers: [
    MobileReleasesService,
    MobileReleaseWhatsNewAiService,
    IosMinVersionAutoBumpSchedulerRegistrationService,
    AndroidMinVersionAutoBumpSchedulerRegistrationService,
  ],
  exports: [MobileReleasesService],
})
export class MobileReleasesModule {}
