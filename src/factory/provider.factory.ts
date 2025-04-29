import { AnalyticsIntegrationEnum } from '../analytics/constants/analytics.constants';
import { MetabaseService } from '../analytics/service/metabase.service';
import { AppConfigService } from '../config/config.service';
import { SMSInterface } from '../notification/interface/sms.interface';
import { Msg91Service } from '../notification/service/msg91.service';
import { SMSIntegrationEnum } from './provider.enum';
export class ProviderFactory {
  public static getSMSFactory() {
    return {
      provide: SMSInterface,
      useFactory: async (
        configService: AppConfigService,
        msg91Service: Msg91Service,
      ) => {
        const smsIntegration = configService.sms.integration;
        switch (smsIntegration) {
          case SMSIntegrationEnum.MSG91:
            return msg91Service;
          default:
            return msg91Service;
        }
      },
      inject: [AppConfigService, Msg91Service],
    };
  }

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
