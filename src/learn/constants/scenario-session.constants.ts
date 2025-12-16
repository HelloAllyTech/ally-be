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
export const DEFAULT_LANGUAGE_ID = 1;

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

export const LANGUAGE_LLM_PROVIDER_CONFIG = {
  'en-IN': {
    llm: {
      provider: 'openai', // Chosen LLM provider
      config: {
        model: 'gpt-4o-mini', // OpenAI model used for response generation
      },
    },
  },
  'hi-IN': {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },
  'ml-IN': {
    llm: {
      provider: 'openai',
      config: {
        model: 'gpt-4o-mini',
      },
    },
  },
  'bn-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
  'mr-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
  'te-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'chirp_2',
      },
    },
  },
  'ta-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
  'gu-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
  'kn-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
  'pa-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
  'or-IN': {
    llm: {
      provider: 'google',
      config: {
        model: 'gemini-2.0-flash-exp',
      },
    },
  },
};

export const LANGUAGE_STT_PROVIDER_CONFIG = {
  'en-IN': {
    stt: {
      provider: 'deepgram', // Chosen STT provider
      config: {
        model: 'nova-3', // Deepgram model used for speech transcription
      },
    },
  },
  'hi-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'ml-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'bn-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'mr-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'te-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'ta-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'gu-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'kn-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'pa-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
  'or-IN': {
    stt: {
      provider: 'google',
      config: {
        model: 'chirp_2',
        location: 'asia-southeast1',
      },
    },
  },
};

// List of fields that need translation
export const SCENARIO_SESSION_TRANSLATABLE_FIELDS = [
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
