import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TIME } from '../common/constants/time.constants';
import { BUILDER_MODEL_DEFAULTS } from '../builder/constants/builder.constants';

export type AwsLogServiceKey = 'ally-be' | 'ally-ai' | 'ally-ai-learn';

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

  /**
   * PAT (or GitHub App installation token) used to dispatch Bug Hunter fix
   * sessions and production releases. Empty on environments that should not
   * write into CI — every caller checks `GithubActionsService.isConfigured`
   * and refuses cleanly rather than failing mid-dispatch.
   */
  get githubToken(): string {
    return this.configService.get<string>('GITHUB_TOKEN', '');
  }

  get githubOrg(): string {
    return this.configService.get<string>('GITHUB_ORG', 'HelloAllyTech');
  }

  /**
   * Base URL a GitHub-hosted runner can reach this API on, handed to the
   * fix-session workflow so it can report progress back. Falls back to the
   * local port purely so a dev environment fails with an obvious connection
   * error instead of a confusing undefined-URL one.
   */
  get publicApiBaseUrl(): string {
    return this.configService.get<string>(
      'PUBLIC_API_BASE_URL',
      `http://localhost:${this.port}`,
    );
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

  /**
   * CloudWatch log group per service, for the super-duper-admin Logs viewer.
   * Unset until infra supplies the real group names — callers must surface a
   * clear "not configured" error rather than querying an empty group name.
   */
  get awsLogs() {
    return {
      logGroups: {
        'ally-be': this.configService.get<string>('AWS_LOG_GROUP_ALLY_BE'),
        'ally-ai': this.configService.get<string>('AWS_LOG_GROUP_ALLY_AI'),
        'ally-ai-learn': this.configService.get<string>(
          'AWS_LOG_GROUP_ALLY_AI_LEARN',
        ),
      } as Record<AwsLogServiceKey, string | undefined>,
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
      labRun: {
        queueUrl: this.configService.get<string>('SQS_LAB_RUN_QUEUE_URL'),
        dlqUrl: this.configService.get<string>('SQS_LAB_RUN_DLQ_URL'),
      },
      knowledgeBase: {
        ingestQueueUrl: this.configService.get<string>(
          'SQS_KB_INGEST_QUEUE_URL',
        ),
        ingestDlqUrl: this.configService.get<string>('SQS_KB_INGEST_DLQ_URL'),
      },
      whatsapp: {
        inboundQueueUrl: this.configService.get<string>(
          'SQS_WHATSAPP_INBOUND_QUEUE_URL',
        ),
        inboundDlqUrl: this.configService.get<string>(
          'SQS_WHATSAPP_INBOUND_DLQ_URL',
        ),
      },
    };
  }

  /**
   * WhatsApp Business Cloud API credentials.
   *
   * All optional so the service boots without them — the bot is off until configured, and the
   * settings row's `enabled` flag is the actual switch. `appSecret` missing makes the webhook fail
   * CLOSED rather than accept unsigned requests.
   */
  get whatsapp() {
    return {
      /** Verifies the webhook-registration handshake (hub.verify_token). Chosen by us. */
      verifyToken: this.configService.get<string>('WHATSAPP_VERIFY_TOKEN'),
      /** Meta app secret; keys the X-Hub-Signature-256 HMAC. */
      appSecret: this.configService.get<string>('WHATSAPP_APP_SECRET'),
      /** The sending number's id, not the number itself. */
      phoneNumberId: this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID'),
      accessToken: this.configService.get<string>('WHATSAPP_ACCESS_TOKEN'),
      graphApiVersion: this.configService.get<string>(
        'WHATSAPP_GRAPH_API_VERSION',
        'v21.0',
      ),
      /**
       * Environment discriminator, following the LiveKit webhook precedent. One WhatsApp number
       * can only point at one webhook URL, so when staging and production share a number this is
       * what stops both replying to the same worker.
       */
      environment: this.configService.get<string>('WHATSAPP_ENVIRONMENT'),
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
    const agentName = this.configService.get<string>(
      'LIVEKIT_AGENT_NAME',
      'Agent',
    );
    return {
      apiKey: this.configService.get<string>('LIVEKIT_API_KEY'),
      apiSecret: this.configService.get<string>('LIVEKIT_API_SECRET'),
      serverUrl: this.configService.get<string>('LIVEKIT_URL'),
      environment: this.configService.get<string>('LIVEKIT_ENVIRONMENT'),
      agentName,
      // Second agent that plays the counselor side in superadmin V2V test
      // sessions; dispatched into the same room under this name.
      simulatedUserAgentName: this.configService.get<string>(
        'SIMULATED_USER_AGENT_NAME',
        'SimulatedUser',
      ),
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

  /**
   * When true, LiveKit room + dispatch metadata carry only a fetch pointer
   * (learn_room_metadata webhook) instead of the full ~180KB scenario
   * envelope, which otherwise rides inside every agent availability request
   * and can blow LiveKit's 3s dispatch window. Requires an agent build that
   * understands `metadataFetch` (ally-ai-learn >= 1.26); flip only after the
   * agent is deployed.
   */
  get learnMetadataFetchEnabled(): boolean {
    // Env values arrive as strings (this key is not in the Joi schema, so
    // nothing coerces it) — compare like the featureFlag getters, NOT like
    // allowDirectAgentDispatch's `get<boolean>() === true`, which reads the
    // string 'true' as false.
    return (
      this.configService.get<string>(
        'LEARN_METADATA_FETCH_ENABLED',
        'false',
      ) === 'true'
    );
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
      // Defaults ON. The `false` branch calls ally-ai's old
      // /summary/scenario/feedback route, which that service no longer serves,
      // so an unset env var used to mean "every learner sees 'Failed to
      // generate summary'". It is also the only branch that produces the
      // supervisor debrief note. Kept as a flag purely as a kill switch.
      useScenarioSessionEvaluation:
        this.configService.get<string>(
          'FEATURE_SCENARIO_SESSION_EVALUATION',
          'true',
        ) !== 'false',
      scenarioSessionAudioRecording:
        this.configService.get<string>(
          'FEATURE_SCENARIO_SESSION_AUDIO_RECORDING',
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
      // Speech-to-text model for the manual scribe-note voice dictation flow.
      // whisper-1 accepts webm/mp4/mp3/wav (<=25MB) and auto-detects language.
      transcriptionModel: this.configService.get<string>(
        'OPENAI_TRANSCRIPTION_MODEL',
        'whisper-1',
      ),
      imageModel: this.configService.get<string>(
        'OPENAI_IMAGE_MODEL',
        'gpt-image-1',
      ),
    };
  }

  get anthropic() {
    const autofillModel = this.configService.get<string>(
      'ANTHROPIC_AUTOFILL_MODEL',
      'claude-sonnet-4-6',
    );
    return {
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
      autofillModel,
      // Analytics Suggestions (admin Analytics -> Suggestions tab). Defaults to
      // the autofill model so there is one model to upgrade, but overridable on
      // its own: this call carries a whole analytics window in its prompt and is
      // the one place where a larger model may be worth the latency.
      suggestionsModel: this.configService.get<string>(
        'ANTHROPIC_SUGGESTIONS_MODEL',
        autofillModel,
      ),
    };
  }

  /**
   * Read access to the self-hosted PostHog, for the UX Signals scan.
   *
   * Write-side PostHog config lives in the frontends (VITE_POSTHOG_*) and is
   * unrelated: this is a *query* credential (a personal API key with read
   * scope), used only to pull aggregates back out.
   *
   * `enabled` is derived rather than configured. A missing value means the scan
   * skips itself and says so, which is what we want on a local or CI boot — the
   * alternative is every environment without a PostHog credential failing a
   * scheduled task once a day.
   *
   * All three are read with NO fallback, `host` included. An internal hostname
   * must not be committed (the repo's gitleaks config rejects them outright),
   * and a default host would be the wrong safety anyway: it would aim a
   * credential at whichever environment the default named, rather than at the
   * one whose credential it is.
   */
  get posthog() {
    const host = this.configService.get<string>('POSTHOG_HOST');
    const personalApiKey = this.configService.get<string>(
      'POSTHOG_PERSONAL_API_KEY',
    );
    const projectId = this.configService.get<string>('POSTHOG_PROJECT_ID');
    return {
      host,
      personalApiKey,
      projectId,
      enabled: Boolean(host && personalApiKey && projectId),
    };
  }

  get roleplayStudio() {
    return {
      // Copilot (spec-authoring interviewer) model. Same family as the
      // anthropic autofill default.
      copilotModel: this.configService.get<string>(
        'ROLEPLAY_COPILOT_MODEL',
        'claude-sonnet-4-6',
      ),
      // Hard cap on tool-use round-trips per copilot turn. A substantial
      // build/edit turn legitimately needs several sequential update_spec
      // patches plus read/compile calls, so keep this generous; on cap-hit the
      // orchestrator does a tool-less wrap-up rather than erroring out.
      maxToolIterations: this.configService.get<number>(
        'ROLEPLAY_COPILOT_MAX_TOOL_ITERATIONS',
        16,
      ),
      // Test runs that outlive this are failed by the redis TTL timer
      // (scaled by the unit count at run creation).
      testRunTimeoutMinutes: this.configService.get<number>(
        'ROLEPLAY_TEST_RUN_TIMEOUT_MINUTES',
        30,
      ),
      // Auto-improve copilot turns stuck IMPROVING past this are failed by
      // the same timer (roleplay-improve:{reportId} watchdog key).
      improveTurnTimeoutMinutes: this.configService.get<number>(
        'ROLEPLAY_IMPROVE_TURN_TIMEOUT_MINUTES',
        10,
      ),
    };
  }

  get builder() {
    return {
      // Model per role in the tiered loop. Defaults live in ONE place
      // (BUILDER_MODEL_DEFAULTS) — the previous per-getter literals drifted
      // (interview on claude-sonnet-4-6 while the build ran claude-sonnet-5).
      interviewModel: this.configService.get<string>(
        'BUILDER_INTERVIEW_MODEL',
        BUILDER_MODEL_DEFAULTS.interview,
      ),
      plannerModel: this.configService.get<string>(
        'BUILDER_PLANNER_MODEL',
        BUILDER_MODEL_DEFAULTS.planner,
      ),
      // `BUILDER_BUILD_MODEL` kept as the env name for the coder tier so an
      // environment that already sets it keeps working.
      coderModel: this.configService.get<string>(
        'BUILDER_BUILD_MODEL',
        BUILDER_MODEL_DEFAULTS.coder,
      ),
      verifierModel: this.configService.get<string>(
        'BUILDER_VERIFIER_MODEL',
        BUILDER_MODEL_DEFAULTS.verifier,
      ),
      // Cheap tier for mechanical passes: repo maps, summaries, consolidation.
      mechanicalModel: this.configService.get<string>(
        'BUILDER_MECHANICAL_MODEL',
        BUILDER_MODEL_DEFAULTS.mechanical,
      ),
      buildEngine: this.configService.get<string>(
        'BUILDER_ENGINE',
        'claude-code',
      ),
      // Hard cap on tool-use round-trips per interview turn. Generous because
      // a substantial turn legitimately chains research calls with several
      // update_prd patches; on cap-hit the orchestrator wraps up in prose.
      maxToolIterations: this.configService.get<number>(
        'BUILDER_MAX_TOOL_ITERATIONS',
        16,
      ),
      // Default spend ceiling per session, in USD. Null disables the cap.
      defaultBudgetUsd: this.configService.get<number>(
        'BUILDER_DEFAULT_BUDGET_USD',
        25,
      ),
    };
  }

  /**
   * Where the admin console is served from, used to build deep links a person
   * follows from outside the app — a Builder pull-request body pointing back
   * at the session that produced it. Falls back to the local dev port so a
   * missing setting yields an obviously-wrong link rather than a silent one.
   */
  get adminBaseUrl(): string {
    return this.configService.get<string>(
      'ADMIN_BASE_URL',
      'http://localhost:8081',
    );
  }

  /**
   * Stacks — the team's curated product-guidance library, reached over HTTP
   * (ally-be is not an MCP client). Optional: unset simply means the
   * interview runs without product guidance.
   */
  get stacks() {
    return {
      apiUrl: this.configService.get<string>('STACKS_API_URL'),
      apiKey: this.configService.get<string>('STACKS_API_KEY'),
    };
  }

  get characterInterview() {
    return {
      // Character-library interview agent model. Same family as the copilot
      // default so there is one model to upgrade.
      model: this.configService.get<string>(
        'CHARACTER_INTERVIEW_MODEL',
        'claude-sonnet-4-6',
      ),
      // Hard cap on tool-use round-trips per interview turn. A normal turn is
      // 1-2 (commentary + ask_question); the final turn legitimately chains
      // get_voices + a validation-retried save_character_draft.
      maxToolIterations: this.configService.get<number>(
        'CHARACTER_INTERVIEW_MAX_TOOL_ITERATIONS',
        8,
      ),
    };
  }

  get gemini() {
    return {
      // Prefer an explicit GEMINI_API_KEY; fall back to the standard
      // GOOGLE_GENERATIVE_AI_API_KEY so an existing Google key works without
      // duplicating the secret. Used by the coaching-chat Gemini provider.
      apiKey:
        this.configService.get<string>('GEMINI_API_KEY') ??
        this.configService.get<string>('GOOGLE_GENERATIVE_AI_API_KEY'),
      imageModel: this.configService.get<string>(
        'GEMINI_IMAGE_MODEL',
        'gemini-2.5-flash-image',
      ),
    };
  }

  get characterImage() {
    return {
      defaultProvider: this.configService.get<string>(
        'CHARACTER_IMAGE_DEFAULT_PROVIDER',
        'openai',
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

  /**
   * Defaults for translating agent prompt templates (main_agent / branching)
   * into Indian languages. These are fallbacks only: the seeded
   * `agent_template_translation` prompt row carries its own provider/model,
   * editable from Prompt Management, which take precedence. Temperature is kept
   * low for faithful translation, and maxTokens is generous since a full agent
   * template can be long.
   */
  get promptTranslation() {
    return {
      defaultProvider: this.configService.get<string>(
        'PROMPT_TRANSLATION_PROVIDER',
        'gemini',
      ),
      defaultModel: this.configService.get<string>(
        'PROMPT_TRANSLATION_MODEL',
        'gemini-2.5-pro',
      ),
      maxTokens: this.configService.get<number>(
        'PROMPT_TRANSLATION_MAX_TOKENS',
        8192,
      ),
      temperature: this.configService.get<number>(
        'PROMPT_TRANSLATION_TEMPERATURE',
        0.2,
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
