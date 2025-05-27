import { Injectable } from '@nestjs/common';
import { AnalyticsInterface } from '../interface/analytics.interface';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import * as jwt from 'jsonwebtoken';
@Injectable()
export class MetabaseService implements AnalyticsInterface {
  private logger = LoggerService.getInstance(MetabaseService.name);
  private readonly metabaseUrl: string;
  private readonly metabaseApiKey: string;
  constructor(private readonly config: AppConfigService) {
    this.metabaseUrl = config.analytics.metabase.url;
    this.metabaseApiKey = config.analytics.metabase.apiKey;
    if (!this.metabaseUrl || !this.metabaseApiKey) {
      throw new Error('Metabase URL and API Key are required');
    }
  }
  getDashboardUrl(
    dashboardId: string,
    params?: Record<string, any>,
  ): Promise<string> {
    this.logger.info(`Getting dashboard url for ${dashboardId} | ${params}`);
    const payload = {
      resource: { dashboard: +dashboardId },
      params: params || {},
      exp: Math.round(Date.now() / 1000) + 10 * 60, // 10 minute expiration
    };
    const token = jwt.sign(payload, this.metabaseApiKey);

    const iframeUrl =
      this.metabaseUrl +
      '/embed/dashboard/' +
      token +
      '#bordered=true&titled=true';
    return Promise.resolve(iframeUrl);
  }
  refreshDashboardUrl(dashboardId: string): Promise<string> {
    this.logger.info(`Refreshing dashboard ${dashboardId}`);
    return Promise.resolve('');
  }
}
