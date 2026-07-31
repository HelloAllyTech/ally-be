import { LanguageCode } from '../enum/scenario-language';

export const DEFAULT_SCENARIO_SESSION_TTL_SECONDS = 1200; // 20 minutes

export const SCENARIO_SESSION_EXAMPLE = {
  id: '123',
  roomId: '123',
  scenarioId: 1,
  counselorId: 1,
  status: 'ACTIVE',
  startedAt: '2021-01-01T00:00:00Z',
  endedAt: '2021-01-01T00:00:00Z',
  score: 100,
  metadata: {},
};

// Default language id for "en-IN"
export const DEFAULT_LANGUAGE_CODE = LanguageCode.EN_IN;

export const DEFAULT_LANGUAGE_TRANSLATION_CODE = 'en';

export const STT_LLM_PROVIDER_CONFIG = {
  // Speech-to-Text service configuration
  stt: {
    provider: 'deepgram', // Chosen STT provider
    config: {
      model: 'nova-3', // Deepgram model used for speech transcription
    },
  },

  // Large Language Model service configuration
  llm: {
    provider: 'openai', // Chosen LLM provider
    config: {
      model: 'gpt-4o-mini', // OpenAI model used for response generation
    },
  },
};

/**
 * Providers that run a locally-served model, where the model name is optional —
 * the server decides. For every other provider a missing model makes the agent
 * fall back to the *platform default* model (gpt-4o-mini) while keeping the
 * chosen provider, e.g. a Gemini client asked for an OpenAI model.
 */
export const LOCAL_LLM_PROVIDERS: readonly string[] = ['ollama', 'vllm'];

export const LANGUAGE_LLM_PROVIDER_CONFIG: Record<
  LanguageCode,
  {
    llm: {
      provider: 'openai' | 'google';
      config: {
        model: string;
      };
    };
  }
> = {
  [LanguageCode.EN_IN]: {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },

  [LanguageCode.HI_IN]: {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },

  [LanguageCode.ML_IN]: {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },

  [LanguageCode.BN_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.MR_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.TE_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'chirp_2',
      },
    },
  },

  [LanguageCode.TA_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.GU_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.KN_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.PA_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.OR_IN]: {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },

  [LanguageCode.EN_GB]: {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },

  [LanguageCode.EN_US]: {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },
};

export const LANGUAGE_STT_PROVIDER_CONFIG: Record<
  LanguageCode,
  {
    stt: {
      provider: 'deepgram' | 'google' | 'sarvam';
      config: {
        model: string;
        location?: string;
        languageCode?: string;
      };
    };
  }
> = {
  [LanguageCode.EN_IN]: {
    stt: {
      provider: 'deepgram',
      config: {
        model: 'nova-3',
      },
    },
  },

  [LanguageCode.HI_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.ML_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.BN_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.MR_IN]: {
    stt: {
      provider: 'sarvam',
      config: {
        model: 'saarika:v2.5',
      },
    },
  },

  [LanguageCode.TE_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.TA_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.GU_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.KN_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.PA_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
        languageCode: 'pa-Guru-IN',
      },
    },
  },

  [LanguageCode.OR_IN]: {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },

  [LanguageCode.EN_GB]: {
    stt: {
      provider: 'deepgram',
      config: {
        model: 'nova-3',
      },
    },
  },

  [LanguageCode.EN_US]: {
    stt: {
      provider: 'deepgram',
      config: {
        model: 'nova-3',
      },
    },
  },
};

// List of fields that need translation
export const SCENARIO_SESSION_TRANSLATABLE_FIELDS: string[] = [
  'title',
  'description',
  'context',
  'openingStatements',
  'sexualOrientation',
  'genderIdentity',
  'customFields',
  'stateInstructions',
];

/** Prefix for ally-ai prompts. Fetched dynamically from DB (WHERE promptCode LIKE 'ally_ai_%'). */
export const ALLY_AI_PROMPT_PREFIX = 'ally_ai_';

/** Prefix for ally-ai-learn prompts. Fetched dynamically from DB (WHERE promptCode LIKE 'ally_ai_learn_%'). */
export const ALLY_AI_LEARN_PROMPT_PREFIX = 'ally_ai_learn_';

export const SKILL_ICONS_S3_PREFIX = 'skill-icons/';

/**
 * Warn threshold for LiveKit room-metadata payload size (bytes). LiveKit caps
 * room metadata at 64 KiB; warn at 75% so growth (knowledge sources, translated
 * prompts, language glossary) is visible well before sessions start failing.
 */
export const ROOM_METADATA_WARN_BYTES = 48 * 1024;

/**
 * How long a stored room-metadata envelope stays fetchable
 * (learn_room_metadata rows). Rooms live minutes to hours; the agent fetches
 * within seconds of dispatch. Sweep runs opportunistically on each store.
 */
export const ROOM_METADATA_STALE_HOURS = 24;
