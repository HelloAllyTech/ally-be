import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Server
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test', 'local')
    .default('development'),
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'debug')
    .default('warn'),

  // JWT
  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().default(7),

  // Database
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().required(),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_DATABASE: Joi.string().required(),

  // AI
  AI_SERVICE_API_URL: Joi.string().required(),
  AI_LEARN_SERVICE_API_URL: Joi.string().required(),
  AI_SERVICE_OUTBOUND_API_KEY: Joi.string().required(), // outbound (BE -> AI)
  AI_LEARN_SERVICE_OUTBOUND_API_KEY: Joi.string().required(), // outbound (BE -> AI Learn Service)

  // AWS
  AWS_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional(),
  AWS_SESSION_TOKEN: Joi.string().optional(),
  AWS_ENDPOINT_URL: Joi.string().optional(),

  /** When `true`, cover-image presign skips S3 and returns a placeholder URL (local dev only). */
  MOCK_SCENARIO_COVER_IMAGE_UPLOAD: Joi.string()
    .valid('true', 'false')
    .optional(),
  /** Optional URL for mock cover image; defaults to placehold.co if unset. */
  MOCK_SCENARIO_COVER_IMAGE_URL: Joi.string().uri().optional(),

  // SCENARIO SESSION AUDIO STORAGE
  SCENARIO_SESSION_AUDIO_STORAGE_S3_BUCKET: Joi.string().required(),
  SCENARIO_SESSION_AUDIO_STORAGE_REGION: Joi.string().required(),
  SCENARIO_SESSION_AUDIO_STORAGE_ACCESS_KEY: Joi.string().required(),
  SCENARIO_SESSION_AUDIO_STORAGE_SECRET: Joi.string().required(),

  // SOURCE EMAIL
  SOURCE_EMAIL: Joi.string().required(),

  // SQS
  SQS_TRANSCRIPTION_REQUEST_QUEUE_URL: Joi.string().required(),
  SQS_TRANSCRIPTION_REQUEST_DLQ_URL: Joi.string().required(),
  SQS_AUDIO_FILE_RETRY_QUEUE_URL: Joi.string().required(),
  SQS_AUDIO_FILE_RETRY_DLQ_URL: Joi.string().required(),

  // CloudWatch
  CLOUDWATCH_HIPAA_LOG_GROUP_NAME: Joi.string().required(),
  CLOUDWATCH_HIPAA_LOG_STREAM_NAME: Joi.string().required(),

  // TEST ACCOUNTS
  TEST_ACCOUNTS: Joi.string().optional(),

  // ENCRYPTION KEYS
  PHI_DATA_ENCRYPTION_KEY: Joi.string()
    .length(64)
    .pattern(/^[a-f0-9]+$/i)
    .optional(),

  // HIPPA
  ENABLE_AUDIT_LOGS_TO_CLOUDWATCH: Joi.boolean().default(false),
  ENABLE_CONSOLE_AUDIT_LOGS: Joi.boolean().default(false),

  // FEATURE FLAGS
  FEATURE_TRIGGER_WARNING: Joi.boolean().default(false),

  // LiveKit
  LIVEKIT_API_KEY: Joi.string().required(),
  LIVEKIT_API_SECRET: Joi.string().required(),
  LIVEKIT_URL: Joi.string().required(),
  LIVEKIT_ENVIRONMENT: Joi.string().required(),

  SIMULATION_SESSION_SECONDS_PER_CREDIT: Joi.number().required(),

  // Simulation Concurrency
  MAX_CONCURRENT_SIMULATIONS: Joi.number().default(100),

  SQS_LEARN_MESSAGE_AND_EVENT_QUEUE_URL: Joi.string().required(),

  // CORS ORIGINS
  ALLOWED_ORIGINS: Joi.string().required(),

  APP_BASE_URL: Joi.string().required(),

  ADMIN_APP_BASE_URL: Joi.string().required(),

  LEARN_MEDIA_PUBLIC_S3_BUCKET: Joi.string().required(),

  ASSETS_S3_BUCKET: Joi.string().required(),

  SCENARIO_PATH_ITEM_MIN_DURATION_FOR_COMPLETION: Joi.string().optional(),

  CASE_ITEM_MIN_DURATION_FOR_COMPLETION: Joi.number().optional(),

  GOOGLE_APPLICATION_CREDENTIALS: Joi.string()
    .required()
    .pattern(/\.json$/, 'JSON file path'),

  PROJECT_ID: Joi.string().required(),

  //google oauth
  GOOGLE_WEB_CLIENT_ID: Joi.string().required(),
  GOOGLE_IOS_CLIENT_ID: Joi.string().required(),
  GOOGLE_ANDROID_CLIENT_ID: Joi.string().required(),

  // apple sign in (comma-separated bundle IDs, e.g. com.helloally.app,com.helloally.app.dev)
  APPLE_BUNDLE_IDS: Joi.string().required(),

  // OpenAI
  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_TRANSLATION_MODEL: Joi.string().default('gpt-4o-mini'),

  // AI Chat
  AI_CHAT_DEFAULT_PROVIDER: Joi.string().valid('openai').default('openai'),
  AI_CHAT_OPENAI_MODEL: Joi.string().default('gpt-4o-mini'),
  AI_CHAT_MAX_TOKENS: Joi.number().default(1500),
  AI_CHAT_TEMPERATURE: Joi.number().min(0).max(2).default(0.7),
  AI_CHAT_MAX_CONTEXT_TOKENS: Joi.number().default(100000),

  // Runtime i18n static file publishing
  I18N_ROOT_DIR: Joi.string().default('/var/www/i18n'),
  I18N_SOURCE_DIR: Joi.string().optional(),
  I18N_VERSION_RETENTION: Joi.number().integer().min(1).default(5),

  // Local dev: when true, allow frontend to trigger agent dispatch (bypasses webhook)
  ALLOW_DIRECT_AGENT_DISPATCH: Joi.boolean().default(false),

  // Bug Hunter fix sessions — dispatching GitHub Actions on the admin's behalf.
  // All optional: with no token, the Bug Hunter tab still works and only the
  // "Start fix session" / "Release to production" buttons refuse (503), which
  // is the correct behaviour on any environment that shouldn't be writing into
  // CI at all (local, dev).
  GITHUB_TOKEN: Joi.string().optional(),
  GITHUB_ORG: Joi.string().default('HelloAllyTech'),
  GITHUB_ACTIONS_TOKEN: Joi.string().optional(),
  GITHUB_MOBILE_REPO: Joi.string().default('HelloAllyTech/ally-mobile'),
  /** Publicly reachable base URL a GitHub-hosted runner can call this API back on. */
  PUBLIC_API_BASE_URL: Joi.string().uri().optional(),

  // App Store Connect API — iOS TestFlight status (Mobile Releases admin
  // page). All optional at the Joi level, same reasoning as
  // GITHUB_ACTIONS_TOKEN: an environment that hasn't provisioned these yet
  // should still boot, and MobileReleasesService.getIosTestflightStatus()
  // refuses cleanly (503) rather than calling Apple with missing credentials.
  APPSTORE_ISSUER_ID: Joi.string().optional(),
  APPSTORE_API_KEY_ID: Joi.string().optional(),
  APPSTORE_API_PRIVATE_KEY: Joi.string().optional(),
  TESTFLIGHT_EXTERNAL_GROUP_NAME: Joi.string().optional(),

  // Voice Preview (TTS provider API keys)
  DEEPGRAM_API_KEY: Joi.string().optional(),
  ELEVENLABS_API_KEY: Joi.string().optional(),
  SARVAM_API_KEY: Joi.string().optional(),
  HUME_API_KEY: Joi.string().optional(),
});
