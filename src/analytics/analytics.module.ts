import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { MetabaseService } from './service/metabase.service';
import { AppConfigModule } from '../config/config.module';
import { ProviderFactory } from '../factory/provider.factory';

@Module({
  imports: [AppConfigModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
  ],
})
export class AnalyticsModule {}
