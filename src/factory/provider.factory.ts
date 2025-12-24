import { AnalyticsIntegrationEnum } from '../analytics/constants/analytics.constants';
import { MetabaseService } from '../analytics/service/metabase.service';
import { AppConfigService } from '../config/config.service';

export class ProviderFactory {
  public static getAnalyticsFactory() {
    return {
      provide: 'AnalyticsInterface',
      useFactory: async (
        configService: AppConfigService,
        metabaseService: MetabaseService,
      ) => {
        const analyticsIntegration = configService.analytics.integration;
        switch (analyticsIntegration) {
          case AnalyticsIntegrationEnum.METABASE:
            return metabaseService;
          default:
            return metabaseService;
        }
      },
      inject: [AppConfigService, MetabaseService],
    };
  }
}
