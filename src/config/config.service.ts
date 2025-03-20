import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
    };
  }

  get jwt() {
    return {
      accessToken: {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '15m',
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
}
