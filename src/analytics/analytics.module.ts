import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { TenantAnalyticsController } from './controller/tenant-analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { PlatformAnalyticsService } from './service/platform-analytics.service';
import { DriftJudgeService } from './service/drift-judge.service';
import { DriftBackfillSchedulerRegistrationService } from './service/drift-backfill-scheduler-registration.service';
import { PlatformAnalyticsRepository } from './repository/platform-analytics.repository';
import { LlmUsageRepository } from './repository/llm-usage.repository';
import { DriftJudgeRepository } from './repository/drift-judge.repository';
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
    PlatformAnalyticsService,
    DriftJudgeService,
    DriftJudgeRepository,
    DriftBackfillSchedulerRegistrationService,
    PlatformAnalyticsRepository,
    LlmUsageRepository,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
    DashboardRepository,
  ],
})
export class AnalyticsModule {}
