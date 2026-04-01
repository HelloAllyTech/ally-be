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

  // OpenAI
  OPENAI_API_KEY: Joi.string().optional(),
  OPENAI_TRANSLATION_MODEL: Joi.string().default('gpt-4o-mini'),

  // AI Chat
  AI_CHAT_DEFAULT_PROVIDER: Joi.string().valid('openai').default('openai'),
  AI_CHAT_OPENAI_MODEL: Joi.string().default('gpt-4o-mini'),
  AI_CHAT_MAX_TOKENS: Joi.number().default(1500),
  AI_CHAT_TEMPERATURE: Joi.number().min(0).max(2).default(0.7),
  AI_CHAT_MAX_CONTEXT_TOKENS: Joi.number().default(100000),

  // Local dev: when true, allow frontend to trigger agent dispatch (bypasses webhook)
  ALLOW_DIRECT_AGENT_DISPATCH: Joi.boolean().default(false),

  // Voice Preview (TTS provider API keys)
  DEEPGRAM_API_KEY: Joi.string().optional(),
  ELEVENLABS_API_KEY: Joi.string().optional(),
  SARVAM_API_KEY: Joi.string().optional(),
  HUME_API_KEY: Joi.string().optional(),
});
