import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TIME } from '../common/constants/time.constants';
@Injectable()
export class AppConfigService {
  constructor(private configService: ConfigService) {}

  get port(): number {
    return this.configService.get<number>('PORT', 8001);
  }

  get nodeEnv(): string {
    return this.configService.get<string>('NODE_ENV', 'development');
  }

  get logLevel(): string {
    return this.configService.get<string>('LOG_LEVEL', 'warn');
  }

  get apiKey(): string {
    return this.configService.get<string>('API_KEY', '');
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
      sentenceCompletionRequired:
        this.configService.get<string>('SENTENCE_COMPLETION_REQUIRED') ===
        'true',
      // inbound key (AI -> BE) remains for any inbound verification needs
      apiKey: this.configService.get<string>('AI_SERVICE_API_KEY'),
      // outbound key (BE -> AI) for x-api-key header
      outboundApiKey: this.configService.get<string>(
        'AI_SERVICE_OUTBOUND_API_KEY',
      ),
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

  get aws() {
    return {
      region: this.configService.get<string>('AWS_REGION'),
      accessKeyId: this.configService.get<string>('AWS_ACCESS_KEY_ID'),
      secretAccessKey: this.configService.get<string>('AWS_SECRET_ACCESS_KEY'),
      sessionToken: this.configService.get<string>('AWS_SESSION_TOKEN'),
      endpointUrl: this.configService.get<string>('AWS_ENDPOINT_URL'),
    };
  }

  get email() {
    return {
      sourceEmail: this.configService.get<string>('SOURCE_EMAIL'),
      ses: {
        region: this.configService.get<string>('SMTP_REGION'),
        accessKeyId: this.configService.get<string>('SMTP_ACCESS_KEY_ID'),
        secretAccessKey: this.configService.get<string>(
          'SMTP_SECRET_ACCESS_KEY',
        ),
      },
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

  get sqs() {
    return {
      region: this.configService.get<string>('AWS_REGION', 'us-east-1'),
      transcription: {
        requestQueueUrl: this.configService.get<string>(
          'SQS_TRANSCRIPTION_REQUEST_QUEUE_URL',
        ),
        requestDlqUrl: this.configService.get<string>(
          'SQS_TRANSCRIPTION_REQUEST_DLQ_URL',
        ),
        responseQueueUrl: this.configService.get<string>(
          'SQS_TRANSCRIPTION_RESPONSE_QUEUE_URL',
        ),
        responseDlqUrl: this.configService.get<string>(
          'SQS_TRANSCRIPTION_RESPONSE_DLQ_URL',
        ),
      },
      audioFile: {
        retryQueueUrl: this.configService.get<string>(
          'SQS_AUDIO_FILE_RETRY_QUEUE_URL',
        ),
        retryDlqUrl: this.configService.get<string>(
          'SQS_AUDIO_FILE_RETRY_DLQ_URL',
        ),
        uploadQueueUrl: this.configService.get<string>(
          'SQS_AUDIO_UPLOAD_QUEUE_URL',
        ),
        uploadDlqUrl: this.configService.get<string>(
          'SQS_AUDIO_UPLOAD_DLQ_URL',
        ),
      },
      learn: {
        messageAndEventQueueUrl: this.configService.get<string>(
          'SQS_LEARN_MESSAGE_AND_EVENT_QUEUE_URL',
        ),
      },
    };
  }
  get s3() {
    return {
      audioBucket: this.configService.get<string>('AUDIO_STORAGE_S3_BUCKET'),
      learnMediaPublicBucket: this.configService.get<string>(
        'LEARN_MEDIA_PUBLIC_S3_BUCKET',
      ),
      assetsBucket: this.configService.get<string>('ASSETS_S3_BUCKET'),
    };
  }

  get audioStorage() {
    return {
      dir: this.configService.get<string>('AUDIO_STORAGE_DIR'),
    };
  }

  get cloudTelephony() {
    return {
      credentialsEncryptionKey: this.configService.get<string>(
        'CLOUD_TELEPHONY_CREDENTIALS_ENCRYPTION_KEY',
      ),
    };
  }

  get ozonetel() {
    return {
      apiUrl: this.configService.get<string>('OZONETEL_API_URL'),
    };
  }

  get api() {
    return {
      baseUrl: this.configService.get<string>('API_BASE_URL'),
    };
  }

  get testAccounts() {
    return this.configService.get<string>('TEST_ACCOUNTS');
  }

  get phiData() {
    return {
      phiDataEncryptionKey: this.configService.get<string>(
        'PHI_DATA_ENCRYPTION_KEY',
      ),
    };
  }

  get cors() {
    const origins = this.configService.get('ALLOWED_ORIGINS', '');
    return {
      allowedOrigins: origins ? origins.split(',') : [],
    };
  }

  get livekit() {
    return {
      apiKey: this.configService.get<string>('LIVEKIT_API_KEY'),
      apiSecret: this.configService.get<string>('LIVEKIT_API_SECRET'),
      serverUrl: this.configService.get<string>('LIVEKIT_URL'),
    };
  }

  get app() {
    return {
      baseUrl: this.configService.get<string>('APP_BASE_URL'),
    };
  }

  get simulationCredits() {
    return {
      lifespanSecondsPerCredit: this.configService.get<number>(
        'SIMULATION_SESSION_SECONDS_PER_CREDIT',
      ),
    };
  }

  get simulationPath() {
    return {
      simulationPathItemMinDurationForCompletion:
        this.configService.get<number>(
          'SCENARIO_PATH_ITEM_MIN_DURATION_FOR_COMPLETION',
        ),
    };
  }
  get cases() {
    return {
      caseItemMinDurationForCompletion: this.configService.get<number>(
        'CASE_ITEM_MIN_DURATION_FOR_COMPLETION',
      ),
    };
  }
  get featureFlag() {
    return {
      stateBasedScenarioInstructions:
        this.configService.get<string>(
          'FEATURE_SCENARIO_STATE_INSTRUCTIONS',
          'false',
        ) === 'true',
    };
  }

  get googleCloudTranslationConfig() {
    return {
      credentials: this.configService.get<string>(
        'GOOGLE_APPLICATION_CREDENTIALS',
      ),
      projectId: this.configService.get<string>('PROJECT_ID'),
    };
  }

  get googleAuth() {
    return {
      webClientId: this.configService.get<string>('GOOGLE_WEB_CLIENT_ID'),
      iosClientId: this.configService.get<string>('GOOGLE_IOS_CLIENT_ID'),
      androidClientId: this.configService.get<string>(
        'GOOGLE_ANDROID_CLIENT_ID',
      ),
    };
  }

  get openai() {
    return {
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      translationModel: this.configService.get<string>(
        'OPENAI_TRANSLATION_MODEL',
        'gpt-4o-mini',
      ),
    };
  }
}
