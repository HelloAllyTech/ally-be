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

  [LanguageCode.EN_GLOBAL]: {
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

  [LanguageCode.EN_GLOBAL]: {
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
  'tone',
  'context',
  'agentGoal',
  'personality',
  'coreMemories',
  'startingState',
  'emotionalNeeds',
  'sessionBehaviorGuidelines',
  'openingStatements',
  'sexualOrientation',
  'genderIdentity',
];
