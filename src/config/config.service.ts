import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TIME } from '../common/constants/time.constants';
@Injectable()
export class AppConfigService {
  constructor(private configService: ConfigService) {}

  get port(): number {
    return this.configService.get<number>('PORT', 3000);
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get database() {
    const config = {
      host: this.configService.get<string>('DB_HOST'),
      port: this.configService.get<number>('DB_PORT'),
      username: this.configService.get<string>('DB_USERNAME'),
      password: this.configService.get<string>('DB_PASSWORD'),
      database: this.configService.get<string>('DB_DATABASE'),
    };

    return config;
  }

  get ai() {
    return {
      apiUrl: this.configService.get<string>('AI_SERVICE_API_URL'),
      deepgramApiKey: this.configService.get<string>('DEEPGRAM_API_KEY')!,
      sentenceCompletionRequired:
        this.configService.get<string>('SENTENCE_COMPLETION_REQUIRED') ===
        'true',
      apiKey: this.configService.get<string>('AI_SERVICE_API_KEY'),
    };
  }

  get jwt() {
    return {
      accessToken: {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '1d',
        ),
      },
      refreshToken: {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_REFRESH_EXPIRES_IN',
          '7d',
        ),
        ttlDays: this.configService.get<number>('REFRESH_TOKEN_TTL_DAYS', 7),
      },
    };
  }

  get slack() {
    return {
      botToken: this.configService.get<string>('SLACK_BOT_TOKEN'),
      channel: this.configService.get<string>('SLACK_CHANNEL'),
    };
  }

  get rateLimit() {
    return {
      otp: {
        ttl: this.configService.get<number>(
          'THROTTLE_TTL_OTP',
          TIME.MINUTE_IN_MS * 10,
        ),
        limit: this.configService.get<number>('THROTTLE_LIMIT_OTP', 5),
      },
    };
  }

  get redis() {
    return {
      host: this.configService.get<string>('REDIS_HOST'),
      port: this.configService.get<number>('REDIS_PORT'),
    };
  }

  get sms() {
    return {
      integration: this.configService.get<string>('SMS_INTEGRATION'),
      msg91: {
        apiKey: this.configService.get<string>('MSG91_API_KEY')!,
        templateId: this.configService.get<string>('MSG91_TEMPLATE_ID')!,
        apiUrl: this.configService.get<string>('MSG91_API_URL')!,
      },
    };
  }

  get aws() {
    return {
      region: this.configService.get<string>('AWS_REGION'),
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
    };
  }

  get email() {
    return {
      integration: this.configService.get<string>('EMAIL_INTEGRATION'),
      ses: {
        region: this.configService.get<string>('SMTP_REGION'),
        sourceEmail: this.configService.get<string>('SES_SOURCE_EMAIL'),
        accessKeyId: this.configService.get<string>('SMTP_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get<string>(
          'SMTP_SECRET_ACCESS_KEY',
        ),
      },
    };
  }

  get audioIngest() {
    return {
      integration: this.configService.get<string>('AUDIO_INGEST_INTEGRATION'),
    };
  }

  get otp() {
    return {
      ttl: this.configService.get<number>(
        'OTP_TTL',
        TIME.MINUTE_IN_SECONDS * 5,
      ),
    };
  }

  get analytics() {
    return {
      integration: this.configService.get<string>('ANALYTICS_INTEGRATION'),
      metabase: {
        url: this.configService.get<string>('METABASE_URL')!,
        apiKey: this.configService.get<string>('METABASE_API_KEY')!,
      },
    };
  }

  get s3() {
    return {
      audioBucket: this.configService.get<string>('AUDIO_STORAGE_S3_BUCKET'),
    };
  }

  get audioStorage() {
    return {
      dir: this.configService.get<string>('AUDIO_STORAGE_DIR'),
    };
  }
}
