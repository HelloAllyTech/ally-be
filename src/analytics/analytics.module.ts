import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { TenantAnalyticsController } from './controller/tenant-analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { HighlightsAnalyticsService } from './service/highlights-analytics.service';
import { HighlightsAnalyticsRepository } from './repository/highlights-analytics.repository';
import { PlatformAnalyticsService } from './service/platform-analytics.service';
import { ScribeAnalyticsService } from './service/scribe-analytics.service';
import { DriftJudgeService } from './service/drift-judge.service';
import { DriftBackfillSchedulerRegistrationService } from './service/drift-backfill-scheduler-registration.service';
import { LanguageJudgeService } from './service/language-judge.service';
import { LanguageBackfillSchedulerRegistrationService } from './service/language-backfill-scheduler-registration.service';
import { PlatformAnalyticsRepository } from './repository/platform-analytics.repository';
import { TenantAnalyticsRepository } from './repository/tenant-analytics.repository';
import { TenantAnalyticsService } from './service/tenant-analytics.service';
import { ScribeAnalyticsRepository } from './repository/scribe-analytics.repository';
import { LlmUsageRepository } from './repository/llm-usage.repository';
import { DriftAnalyticsRepository } from './repository/drift-analytics.repository';
import { DriftJudgeRepository } from './repository/drift-judge.repository';
import { LanguageJudgeRepository } from './repository/language-judge.repository';
import { LanguageAnalyticsRepository } from './repository/language-analytics.repository';
import { LanguageAnalyticsService } from './service/language-analytics.service';
import { MetabaseService } from './service/metabase.service';
import { AppConfigModule } from '../config/config.module';
import { ProviderFactory } from '../factory/provider.factory';
import { UserModule } from '../user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dashboard } from './entity/dashboards.entity';
import { DashboardRepository } from './repository/dashboard.repository';
import { ChatModule } from '../chat/chat.module';
import { DashboardTenant } from './entity/dashboard-tenant.entity';
import { DashboardGroup } from './entity/dashboard-group.entity';
import { TenantModule } from 'src/tenant/tenant.module';

@Module({
  imports: [
    AppConfigModule,
    UserModule,
    TypeOrmModule.forFeature([Dashboard, DashboardTenant, DashboardGroup]),
    ChatModule,
    TenantModule,
  ],
  controllers: [AnalyticsController, TenantAnalyticsController],
  providers: [
    AnalyticsService,
    HighlightsAnalyticsService,
    HighlightsAnalyticsRepository,
    PlatformAnalyticsService,
    ScribeAnalyticsService,
    DriftJudgeService,
    DriftJudgeRepository,
    DriftBackfillSchedulerRegistrationService,
    LanguageJudgeService,
    LanguageJudgeRepository,
    LanguageBackfillSchedulerRegistrationService,
    LanguageAnalyticsService,
    LanguageAnalyticsRepository,
    PlatformAnalyticsRepository,
    TenantAnalyticsService,
    TenantAnalyticsRepository,
    ScribeAnalyticsRepository,
    LlmUsageRepository,
    DriftAnalyticsRepository,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
    DashboardRepository,
  ],
})
export class AnalyticsModule {}
