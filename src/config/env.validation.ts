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
  DEEPGRAM_API_KEY: Joi.string().required(),

  // SQS
  AWS_REGION: Joi.string().default('us-east-1'),
  SQS_TRANSCRIPTION_REQUEST_QUEUE_URL: Joi.string().required(),
  SQS_TRANSCRIPTION_REQUEST_DLQ_URL: Joi.string().required(),
  SQS_TRANSCRIPTION_RESPONSE_QUEUE_URL: Joi.string().required(),
  SQS_TRANSCRIPTION_RESPONSE_DLQ_URL: Joi.string().required(),
  SQS_AUDIO_FILE_RETRY_QUEUE_URL: Joi.string().required(),
  SQS_AUDIO_FILE_RETRY_DLQ_URL: Joi.string().required(),
  SQS_AUDIO_UPLOAD_QUEUE_URL: Joi.string().required(),
  SQS_AUDIO_UPLOAD_DLQ_URL: Joi.string().required(),

  // TEST ACCOUNTS
  TEST_ACCOUNTS: Joi.string().optional(),

  // LiveKit
  LIVEKIT_API_KEY: Joi.string().required(),
  LIVEKIT_API_SECRET: Joi.string().required(),
  LIVEKIT_URL: Joi.string().required(),

  SQS_LEARN_MESSAGE_AND_EVENT_QUEUE_URL: Joi.string().required(),

  // CORS ORIGINS
  ALLOWED_ORIGINS: Joi.string().required(),
});
