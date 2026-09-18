import { Injectable } from '@nestjs/common';
import { App, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, SendResponse } from 'firebase-admin/messaging';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';
import { DeviceTokenService } from './device-token.service';

export interface PushPayload {
  title: string;
  body: string;
  type: string;
  screen?: string;
}

const DEAD_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * FCM push, data-only (no `notification` block) so the client fully controls
 * display — see `pushNotificationService.ts`/`notificationNavigation.ts` on
 * the mobile side for how the `type`/`screen` fields get routed. No-ops
 * (with a one-time warning) when `FIREBASE_SERVICE_ACCOUNT_JSON_BASE64` isn't
 * set, rather than throwing — most environments won't have it configured.
 */
@Injectable()
export class PushService {
  private static readonly logger = LoggerService.getInstance(PushService.name);

  private app: App | null = null;
  private warnedNotConfigured = false;

  constructor(
    private readonly configService: AppConfigService,
    private readonly deviceTokenService: DeviceTokenService,
  ) {}

  async sendDataMessage(tokens: string[], payload: PushPayload): Promise<void> {
    if (!tokens.length) {
      return;
    }
    const app = this.getApp();
    if (!app) {
      return;
    }

    // FCM data payloads require every value to be a string.
    const data: Record<string, string> = {
      type: payload.type,
      title: payload.title,
      body: payload.body,
    };
    if (payload.screen) {
      data.screen = payload.screen;
    }

    try {
      const response = await getMessaging(app).sendEachForMulticast({
        tokens,
        data,
      });
      await this.cleanUpDeadTokens(tokens, response.responses);
    } catch (error) {
      PushService.logger.error(`FCM send failed: ${error.message}`);
    }
  }

  private getApp(): App | null {
    if (this.app) {
      return this.app;
    }

    const encoded = this.configService.firebaseServiceAccountJsonBase64;
    if (!encoded) {
      if (!this.warnedNotConfigured) {
        PushService.logger.warn(
          'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is not set — push notifications are disabled',
        );
        this.warnedNotConfigured = true;
      }
      return null;
    }

    try {
      const serviceAccount = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf8'),
      );
      this.app = getApps().length
        ? getApp()
        : initializeApp({ credential: cert(serviceAccount) });
      return this.app;
    } catch (error) {
      PushService.logger.error(
        `Failed to initialize firebase-admin: ${error.message}`,
      );
      return null;
    }
  }

  /** A token FCM reports as dead is deleted rather than retried forever. */
  private async cleanUpDeadTokens(
    tokens: string[],
    responses: SendResponse[],
  ): Promise<void> {
    await Promise.all(
      responses.map((response, index) => {
        const code = response.error?.code;
        if (!response.success && code && DEAD_TOKEN_ERROR_CODES.has(code)) {
          return this.deviceTokenService.deleteToken(tokens[index]);
        }
        return Promise.resolve();
      }),
    );
  }
}
