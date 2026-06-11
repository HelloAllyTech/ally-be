import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { TenantAnalyticsController } from './controller/tenant-analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { PlatformAnalyticsService } from './service/platform-analytics.service';
import { PlatformAnalyticsRepository } from './repository/platform-analytics.repository';
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
    PlatformAnalyticsRepository,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
    DashboardRepository,
  ],
})
export class AnalyticsModule {}
