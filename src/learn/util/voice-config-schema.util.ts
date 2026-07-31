import { Gender } from '../enum/gender.enum';
import { TtsProvider } from '../enum/tts-provider.enum';
import {
  ProviderConfigField,
  validateProviderConfig,
} from './provider-config-schema.util';

/**
 * Per-provider shape of `scenario_voices.config`.
 *
 * Derived from the `from_config()` classmethods in `ally-ai-learn/app/tts/*.py`
 * — those are the only consumers of this column, so anything they don't read is
 * dead weight and anything they require but can't find makes the client raise,
 * which `create_tts_client()` swallows into a default-Deepgram fallback.
 *
 * The admin dashboard renders its voice form straight off this shape
 * (`ally-web/apps/ally-admin-dashboard/src/constants/voiceProviders.ts` mirrors
 * it); keep the two in sync when a provider is added or its client changes.
 */
/**
 * Voices use the shared provider-config field shape — the same one STT and LLM
 * configs are described with (`provider-config-schema.util.ts`), so all three
 * registries validate through one implementation and the admin dashboard can
 * render all three forms from one component.
 */
export type VoiceConfigField = ProviderConfigField;

/**
 * `config.gender` is optional, but it matters:
 * `getLanguagesForScenario(hasVoices)` only offers a language for simulation
 * creation when it has both a male and a female voice, and `getFallbackVoice()`
 * matches on `config->>'gender'`. A voice saved without one quietly reduces what
 * its language can be used for.
 *
 * It is deliberately not enforced — plenty of existing rows have no gender and
 * must stay editable, and a provider can be perfectly dispatchable without one.
 * The admin dashboard surfaces the gap instead (a "Not set" badge in the voices
 * table, an "Unspecified gender" group in the studio picker, and a non-blocking
 * warning on the edit form), and the `genders=unset` filter finds them in bulk.
 *
 * When a value IS present it still has to be one the rest of the system
 * understands, so the enum check below stays.
 */
const GENDER_FIELD: VoiceConfigField = {
  key: 'gender',
  required: false,
  type: 'string',
  options: Object.values(Gender),
};
export const VOICE_CONFIG_SCHEMA: Record<TtsProvider, VoiceConfigField[]> = {
  [TtsProvider.DEEPGRAM]: [
    GENDER_FIELD,
    { key: 'model', required: true, type: 'string' },
  ],
  [TtsProvider.ELEVENLABS]: [
    GENDER_FIELD,
    { key: 'model', required: true, type: 'string' },
    {
      key: 'voice_id',
      required: true,
      aliases: ['voiceId'],
      type: 'string',
    },
  ],
  [TtsProvider.SARVAM]: [
    GENDER_FIELD,
    { key: 'model', required: true, type: 'string' },
    { key: 'speaker', required: true, type: 'string' },
    { key: 'age', required: false, type: 'string' },
  ],
  [TtsProvider.GOOGLE]: [
    GENDER_FIELD,
    { key: 'voice_name', required: false, type: 'string' },
    { key: 'model_name', required: false, type: 'string' },
    { key: 'voice_cloning_key', required: false, type: 'string' },
  ],
  [TtsProvider.HUME]: [
    GENDER_FIELD,
    { key: 'voice_name', required: true, type: 'string' },
    { key: 'instant_mode', required: false, type: 'boolean' },
    {
      key: 'voice_provider',
      required: false,
      type: 'string',
      options: ['HUME_AI', 'CUSTOM_VOICE'],
    },
  ],
};

/**
 * Validate a voice config against its provider's schema.
 *
 * Thin wrapper over the shared validator; kept as a named export because the
 * voices service and its tests call it directly.
 */
export const validateVoiceConfig = (
  provider: string,
  config: Record<string, unknown> | undefined | null,
): string[] =>
  validateProviderConfig(VOICE_CONFIG_SCHEMA, provider, config, {
    subject: 'voice',
    supported: Object.values(TtsProvider),
    // Upper-cased for the message regardless of how the row is stored: the
    // provider reads as a brand here, not as a storage key.
    requiredMessage: (matched, key) =>
      `${matched.toUpperCase()} voices require "${key}" in config.`,
    notAnObjectMessage: 'Voice config must be a JSON object.',
  });
