import { TtsProvider } from '../../enum/tts-provider.enum';
import { validateVoiceConfig } from '../voice-config-schema.util';

describe('validateVoiceConfig', () => {
  describe('provider', () => {
    it('rejects a provider the runtime has no client for', () => {
      const errors = validateVoiceConfig('OPENAI', { gender: 'male' });

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Unsupported voice provider "OPENAI"');
    });

    it('accepts a supported provider regardless of casing', () => {
      const config = {
        gender: 'male',
        model: 'bulbul:v2',
        speaker: 'abhilash',
      };

      expect(validateVoiceConfig('sarvam', config)).toEqual([]);
      expect(validateVoiceConfig('Sarvam', config)).toEqual([]);
      expect(validateVoiceConfig('SARVAM', config)).toEqual([]);
    });

    it('rejects a non-object config', () => {
      expect(validateVoiceConfig(TtsProvider.GOOGLE, null)).toEqual([
        'Voice config must be a JSON object.',
      ]);
      expect(validateVoiceConfig(TtsProvider.GOOGLE, [] as any)).toEqual([
        'Voice config must be a JSON object.',
      ]);
    });
  });

  describe('gender', () => {
    // Not enforced: existing rows without a gender must stay editable, and a
    // voice dispatches fine without one. The dashboard surfaces the gap instead
    // — it only affects which languages the studio offers.
    it('is not required by any provider', () => {
      expect(
        validateVoiceConfig(TtsProvider.SARVAM, {
          model: 'bulbul:v2',
          speaker: 'abhilash',
        }),
      ).toEqual([]);

      expect(validateVoiceConfig(TtsProvider.GOOGLE, {})).toEqual([]);
    });

    it('accepts an empty string, same as omitting it', () => {
      expect(validateVoiceConfig(TtsProvider.GOOGLE, { gender: '' })).toEqual(
        [],
      );
    });

    it('still rejects a value outside the Gender enum when one is given', () => {
      expect(
        validateVoiceConfig(TtsProvider.GOOGLE, { gender: 'woman' }),
      ).toEqual(['"gender" must be one of: male, female, non-binary.']);
    });

    it('does not let a missing gender mask a missing required field', () => {
      expect(validateVoiceConfig(TtsProvider.SARVAM, {})).toEqual([
        'SARVAM voices require "model" in config.',
        'SARVAM voices require "speaker" in config.',
      ]);
    });
  });

  describe('per-provider required fields', () => {
    it('requires model for Deepgram', () => {
      expect(
        validateVoiceConfig(TtsProvider.DEEPGRAM, { gender: 'female' }),
      ).toEqual(['DEEPGRAM voices require "model" in config.']);
    });

    it('requires model and voice_id for ElevenLabs', () => {
      expect(
        validateVoiceConfig(TtsProvider.ELEVENLABS, { gender: 'female' }),
      ).toEqual([
        'ELEVENLABS voices require "model" in config.',
        'ELEVENLABS voices require "voice_id" in config.',
      ]);
    });

    it('accepts the legacy voiceId spelling for ElevenLabs', () => {
      expect(
        validateVoiceConfig(TtsProvider.ELEVENLABS, {
          gender: 'female',
          model: 'eleven_turbo_v2_5',
          voiceId: '21m00Tcm4TlvDq8ikWAM',
        }),
      ).toEqual([]);
    });

    it('requires model and speaker for Sarvam', () => {
      expect(
        validateVoiceConfig(TtsProvider.SARVAM, { gender: 'male' }),
      ).toEqual([
        'SARVAM voices require "model" in config.',
        'SARVAM voices require "speaker" in config.',
      ]);
    });

    it('requires voice_name for Hume', () => {
      expect(validateVoiceConfig(TtsProvider.HUME, { gender: 'male' })).toEqual(
        ['HUME voices require "voice_name" in config.'],
      );
    });

    it('requires nothing beyond gender for Google', () => {
      expect(
        validateVoiceConfig(TtsProvider.GOOGLE, { gender: 'female' }),
      ).toEqual([]);
    });
  });

  describe('optional fields', () => {
    it('type-checks booleans', () => {
      expect(
        validateVoiceConfig(TtsProvider.HUME, {
          gender: 'male',
          voice_name: 'Priya',
          instant_mode: 'yes',
        }),
      ).toEqual(['"instant_mode" must be true or false.']);
    });

    it("constrains voice_provider to Hume's two sources", () => {
      expect(
        validateVoiceConfig(TtsProvider.HUME, {
          gender: 'male',
          voice_name: 'Priya',
          voice_provider: 'ELEVENLABS',
        }),
      ).toEqual(['"voice_provider" must be one of: HUME_AI, CUSTOM_VOICE.']);
    });
  });

  it('tolerates keys the schema does not describe', () => {
    // Seeded Google rows carry a redundant languageCode; rejecting it would
    // make those rows uneditable, and the runtime simply ignores it.
    expect(
      validateVoiceConfig(TtsProvider.GOOGLE, {
        gender: 'female',
        voice_name: 'en-IN-Chirp3-HD-Achernar',
        languageCode: 'en-IN',
      }),
    ).toEqual([]);
  });

  it('accepts the shapes the seeder actually writes', () => {
    expect(
      validateVoiceConfig(TtsProvider.SARVAM, {
        age: 'adult',
        model: 'bulbul:v2',
        gender: 'male',
        speaker: 'abhilash',
      }),
    ).toEqual([]);

    expect(
      validateVoiceConfig(TtsProvider.GOOGLE, {
        gender: 'female',
        voice_name: 'en-US-Chirp3-HD-Achernar',
        languageCode: 'en-US',
      }),
    ).toEqual([]);
  });
});
