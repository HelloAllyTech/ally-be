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

  get isLocal(): boolean {
    return this.nodeEnv === 'local';
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
      learnApiUrl: this.configService.get<string>('AI_LEARN_SERVICE_API_URL'),
      sentenceCompletionRequired:
        this.configService.get<string>('SENTENCE_COMPLETION_REQUIRED') ===
        'true',
      // outbound key (BE -> AI) for x-api-key header
      outboundApiKey: this.configService.get<string>(
        'AI_SERVICE_OUTBOUND_API_KEY',
      ),
      learnOutboundApiKey: this.configService.get<string>(
        'AI_LEARN_SERVICE_OUTBOUND_API_KEY',
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
      port: this.configService.get<number>('REDIS_PORT', 6379),
      prefix: this.configService.get<string>('REDIS_PREFIX', 'ally'),
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

  /** Local/dev only: bypass S3 for scenario cover image presign. */
  get isMockScenarioCoverImageUpload(): boolean {
    return (
      this.configService.get<string>('MOCK_SCENARIO_COVER_IMAGE_UPLOAD') ===
      'true'
    );
  }

  get mockScenarioCoverImageUrl(): string {
    const url = this.configService.get<string>('MOCK_SCENARIO_COVER_IMAGE_URL');
    if (url?.trim()) {
      return url.trim();
    }
    return 'https://placehold.co/1920x1080/png?text=Local+dev+cover';
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
      },
      audioFile: {
        retryQueueUrl: this.configService.get<string>(
          'SQS_AUDIO_FILE_RETRY_QUEUE_URL',
        ),
        retryDlqUrl: this.configService.get<string>(
          'SQS_AUDIO_FILE_RETRY_DLQ_URL',
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
      environment: this.configService.get<string>('LIVEKIT_ENVIRONMENT'),
      agentName: this.configService.get<string>('LIVEKIT_AGENT_NAME', 'Agent'),
    };
  }

  /**
   * When true, frontend can trigger agent dispatch (for local dev when webhook unreachable).
   * Only enabled by explicit env var or NODE_ENV=local. Not enabled for NODE_ENV=development,
   * so dev server (webhook reachable) does not double-dispatch and cause voice echo.
   */
  get allowDirectAgentDispatch(): boolean {
    const explicit =
      this.configService.get<boolean>('ALLOW_DIRECT_AGENT_DISPATCH') === true;
    const isLocalOnly = this.nodeEnv === 'local';
    return explicit || isLocalOnly;
  }

  get app() {
    return {
      baseUrl: this.configService.get<string>('APP_BASE_URL'),
      adminBaseUrl: this.configService.get<string>('ADMIN_APP_BASE_URL'),
    };
  }

  get simulationCredits() {
    return {
      lifespanSecondsPerCredit: this.configService.get<number>(
        'SIMULATION_SESSION_SECONDS_PER_CREDIT',
      ),
    };
  }

  get simulationConcurrency() {
    return {
      maxConcurrentSimulations: this.configService.get<number>(
        'MAX_CONCURRENT_SIMULATIONS',
        100,
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
      useScenarioSessionEvaluation:
        this.configService.get<string>(
          'FEATURE_SCENARIO_SESSION_EVALUATION',
          'false',
        ) === 'true',
      scenarioSessionAudioRecording:
        this.configService.get<string>(
          'FEATURE_SCENARIO_SESSION_AUDIO_RECORDING',
          'false',
        ) === 'true',
      // Thinking Filler is gated to an explicit email allowlist (comma-separated,
      // case-insensitive) for STUDIO ACCESS ONLY — i.e. who may see/use the
      // Thinking Filler toggle when authoring a scenario. Runtime playback is
      // NOT email-gated; it follows the scenario's fillerEnabled setting.
      // Empty list => no one can configure it.
      thinkingFillerEmails: (
        this.configService.get<string>('FEATURE_THINKING_FILLER_EMAILS', '') ||
        ''
      )
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    };
  }

  /**
   * Whether the user may CONFIGURE the Thinking Filler in Studio (email
   * allowlist). Exposed via /users/me to gate the Studio toggle. Does NOT
   * affect runtime playback, which is driven solely by the scenario's
   * fillerEnabled setting. Case-insensitive exact match.
   */
  isThinkingFillerAllowed(email?: string | null): boolean {
    if (!email) return false;
    return this.featureFlag.thinkingFillerEmails.includes(
      email.trim().toLowerCase(),
    );
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

  get appleAuth() {
    const bundleIds = this.configService
      .get<string>('APPLE_BUNDLE_IDS', '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    return { bundleIds };
  }

  get openai() {
    return {
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
      translationModel: this.configService.get<string>(
        'OPENAI_TRANSLATION_MODEL',
        'gpt-4o-mini',
      ),
      autofillModel: this.configService.get<string>(
        'OPENAI_AUTOFILL_MODEL',
        'gpt-5-mini',
      ),
    };
  }

  get anthropic() {
    return {
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
      autofillModel: this.configService.get<string>(
        'ANTHROPIC_AUTOFILL_MODEL',
        'claude-sonnet-4-6',
      ),
    };
  }

  get aiChat() {
    return {
      defaultProvider: this.configService.get<string>(
        'AI_CHAT_DEFAULT_PROVIDER',
        'openai',
      ),
      model: this.configService.get<string>(
        'AI_CHAT_OPENAI_MODEL',
        'gpt-4o-mini',
      ),
      maxTokens: this.configService.get<number>('AI_CHAT_MAX_TOKENS', 1500),
      temperature: this.configService.get<number>('AI_CHAT_TEMPERATURE', 0.7),
      maxContextTokens: this.configService.get<number>(
        'AI_CHAT_MAX_CONTEXT_TOKENS',
        100000,
      ),
    };
  }

  get i18n() {
    return {
      rootDir: this.configService.get<string>('I18N_ROOT_DIR', '/var/www/i18n'),
      sourceDir: this.configService.get<string>('I18N_SOURCE_DIR'),
      versionRetention: this.configService.get<number>(
        'I18N_VERSION_RETENTION',
        5,
      ),
    };
  }

  get voicePreview() {
    return {
      deepgramApiKey: this.configService.get<string>('DEEPGRAM_API_KEY'),
      elevenlabsApiKey: this.configService.get<string>('ELEVENLABS_API_KEY'),
      sarvamApiKey: this.configService.get<string>('SARVAM_API_KEY'),
      humeApiKey: this.configService.get<string>('HUME_API_KEY'),
    };
  }

  get scenarioSessionAudioStorage() {
    return {
      bucket: this.configService.get<string>(
        'SCENARIO_SESSION_AUDIO_STORAGE_S3_BUCKET',
      ),
      region: this.configService.get<string>(
        'SCENARIO_SESSION_AUDIO_STORAGE_REGION',
      ),
      accessKey: this.configService.get<string>(
        'SCENARIO_SESSION_AUDIO_STORAGE_ACCESS_KEY',
      ),
      secret: this.configService.get<string>(
        'SCENARIO_SESSION_AUDIO_STORAGE_SECRET',
      ),
    };
  }
}
