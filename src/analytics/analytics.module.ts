import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { MetabaseService } from './service/metabase.service';
import { AppConfigModule } from '../config/config.module';
import { ProviderFactory } from '../factory/provider.factory';
import { UserModule } from '../user/user.module';
import { DashboardRepository } from './repository/dashboard.repository';
import { AnalyticsRepository } from './repository/analytics.repository';

@Module({
  imports: [AppConfigModule, UserModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
    DashboardRepository,
    AnalyticsRepository,
  ],
})
export class AnalyticsModule {}
