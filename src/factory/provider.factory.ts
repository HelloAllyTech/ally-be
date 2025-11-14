import { AnalyticsIntegrationEnum } from '../analytics/constants/analytics.constants';
import { MetabaseService } from '../analytics/service/metabase.service';
import { AppConfigService } from '../config/config.service';
import { AudioIngestIntegrationEnum } from './provider.enum';
import { ExotelConferenceCallService } from '../audio-ingest/service/exotel-conference-call.service';
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

  public static getAudioIngestFactory() {
    return {
      provide: 'AudioIngestInterface',
      useFactory: async (
        configService: AppConfigService,
        exotelService: ExotelConferenceCallService,
      ) => {
        const audioIngestIntegration = configService.audioIngest.integration;
        switch (audioIngestIntegration) {
          case AudioIngestIntegrationEnum.EXOTEL:
            return exotelService;
          default:
            return exotelService;
        }
      },
      inject: [AppConfigService, ExotelConferenceCallService],
    };
  }
}
