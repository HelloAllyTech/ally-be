import { AnalyticsIntegrationEnum } from '../analytics/constants/analytics.constants';
import { MetabaseService } from '../analytics/service/metabase.service';
import { AppConfigService } from '../config/config.service';
import { SMSInterface } from '../notification/interface/sms.interface';
import { Msg91Service } from '../notification/service/msg91.service';
import {
  AudioIngestIntegrationEnum,
  SMSIntegrationEnum,
} from './provider.enum';
import { ExotelService } from '../audio-ingest/service/exotel.service';
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

  public static getAudioIngestFactory() {
    return {
      provide: 'AudioIngestInterface',
      useFactory: async (
        configService: AppConfigService,
        exotelService: ExotelService,
      ) => {
        const audioIngestIntegration = configService.audioIngest.integration;
        switch (audioIngestIntegration) {
          case AudioIngestIntegrationEnum.EXOTEL:
            return exotelService;
          default:
            return exotelService;
        }
      },
      inject: [AppConfigService, ExotelService],
    };
  }
}
