import { ProviderConfigSchema } from '../util/provider-config-schema.util';

/**
 * Field schemas for the STT and LLM registries, in the same declarative shape
 * the TTS voices already use (`voice-config-schema.util.ts`).
 *
 * Derived from what the runtime actually reads:
 * `ally-ai-learn/app/stt/factory.py` and `app/llms/factory.py`.
 *
 * `model` being `required` on most providers is not cosmetic. Both factories
 * fall back to the *platform default* model when it is missing — Deepgram's
 * "nova-3" for STT, "gpt-4o-mini" for LLM — while keeping the chosen provider.
 * So an ElevenLabs config with no model builds an ElevenLabs client asking for
 * a Deepgram model: the session starts and transcribes nothing. Requiring it
 * here makes that unrepresentable.
 */
export const STT_CONFIG_SCHEMA: ProviderConfigSchema = {
  deepgram: [{ key: 'model', required: true, type: 'string' }],
  sarvam: [{ key: 'model', required: true, type: 'string' }],
  elevenlabs: [{ key: 'model', required: true, type: 'string' }],
  google: [
    { key: 'model', required: true, type: 'string' },
    { key: 'location', required: false, type: 'string' },
    // Script-qualified code for languages where the session code isn't what
    // Google accepts (Punjabi needs 'pa-Guru-IN', not 'pa-IN').
    { key: 'languageCode', required: false, type: 'string' },
  ],
};

/**
 * Ollama and vLLM serve whatever model the server is running, so `model` is
 * genuinely optional there — expressed by omitting `required`, rather than by
 * a special-case branch in a validator.
 */
const LLM_TEMPERATURE_FIELD = {
  key: 'temperature',
  required: false,
  type: 'number' as const,
  min: 0,
  max: 2,
};

export const LLM_CONFIG_SCHEMA: ProviderConfigSchema = {
  openai: [
    { key: 'model', required: true, type: 'string' },
    LLM_TEMPERATURE_FIELD,
  ],
  // ally-ai-learn maps both 'google' and 'gemini' to the Gemini client.
  google: [
    { key: 'model', required: true, type: 'string' },
    LLM_TEMPERATURE_FIELD,
  ],
  gemini: [
    { key: 'model', required: true, type: 'string' },
    LLM_TEMPERATURE_FIELD,
  ],
  ollama: [
    { key: 'model', required: false, type: 'string' },
    LLM_TEMPERATURE_FIELD,
  ],
  vllm: [
    { key: 'model', required: false, type: 'string' },
    LLM_TEMPERATURE_FIELD,
  ],
};
