import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  LLM_CONFIG_SCHEMA,
  STT_CONFIG_SCHEMA,
} from '../../constants/provider-config-schemas.constants';
import { validateProviderConfig } from '../../util/provider-config-schema.util';
import { UpdateScenarioDto } from '../update-scenario.dto';

const CONFIG_ID = '3f1b0c8e-77a1-4d2b-9a55-1c0f6c2e4d90';
const OTHER_CONFIG_ID = '9c2e4d90-1c0f-4d2b-9a55-77a13f1b0c8e';

describe('UpdateScenarioDto sttConfigByLanguage', () => {
  const errorsFor = async (sttConfigByLanguage: unknown) => {
    const dto = plainToInstance(UpdateScenarioDto, { sttConfigByLanguage });
    const errors = await validate(dto);
    return errors.filter((error) => error.property === 'sttConfigByLanguage');
  };

  it('accepts a per-language map of registry ids', async () => {
    expect(
      await errorsFor({ '1': CONFIG_ID, '9': OTHER_CONFIG_ID }),
    ).toHaveLength(0);
  });

  it('treats omitted, null and empty as "no overrides"', async () => {
    expect(await errorsFor(undefined)).toHaveLength(0);
    expect(await errorsFor(null)).toHaveLength(0);
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('accepts a cleared entry as "inherit this language\'s default"', async () => {
    // null is what the API sends; '' is what an unset dropdown produces.
    expect(await errorsFor({ '9': null })).toHaveLength(0);
    expect(await errorsFor({ '9': '' })).toHaveLength(0);
  });

  it('rejects keys that are not language ids', async () => {
    // A language *code* silently never matches (lookup is by id), so the
    // override would appear to save and then do nothing.
    expect(await errorsFor({ 'kn-IN': CONFIG_ID })).not.toHaveLength(0);
    expect(await errorsFor({ '': CONFIG_ID })).not.toHaveLength(0);
  });

  it('rejects values that are not registry ids', async () => {
    expect(await errorsFor({ '9': 'elevenlabs' })).not.toHaveLength(0);
    expect(
      await errorsFor({
        '9': {
          provider: 'elevenlabs',
          config: { model: 'scribe_v2_realtime' },
        },
      }),
    ).not.toHaveLength(0);
    expect(await errorsFor({ '9': 42 })).not.toHaveLength(0);
  });

  it('rejects shapes that are not a keyed object', async () => {
    expect(await errorsFor('elevenlabs')).not.toHaveLength(0);
    expect(await errorsFor([])).not.toHaveLength(0);
    expect(await errorsFor(42)).not.toHaveLength(0);
  });

  it('rejects the map when any single language is malformed', async () => {
    expect(
      await errorsFor({ '1': CONFIG_ID, '9': 'not-an-id' }),
    ).not.toHaveLength(0);
  });
});

describe('provider config schemas', () => {
  it('requires a model for every hosted STT provider', () => {
    for (const provider of ['deepgram', 'google', 'sarvam', 'elevenlabs']) {
      expect(
        validateProviderConfig(STT_CONFIG_SCHEMA, provider, {}),
      ).not.toHaveLength(0);
      expect(
        validateProviderConfig(STT_CONFIG_SCHEMA, provider, { model: 'x' }),
      ).toHaveLength(0);
    }
  });

  it('accepts Google STT extras and rejects an unknown provider', () => {
    expect(
      validateProviderConfig(STT_CONFIG_SCHEMA, 'google', {
        model: 'chirp_2',
        location: 'asia-southeast1',
        languageCode: 'pa-Guru-IN',
      }),
    ).toHaveLength(0);
    expect(
      validateProviderConfig(STT_CONFIG_SCHEMA, 'whisper', {
        model: 'large-v3',
      }),
    ).not.toHaveLength(0);
  });

  it('requires a model for hosted LLM providers but not local ones', () => {
    // ollama/vllm serve whatever the server is running.
    expect(
      validateProviderConfig(LLM_CONFIG_SCHEMA, 'openai', {}),
    ).not.toHaveLength(0);
    expect(
      validateProviderConfig(LLM_CONFIG_SCHEMA, 'google', {}),
    ).not.toHaveLength(0);
    expect(
      validateProviderConfig(LLM_CONFIG_SCHEMA, 'ollama', {}),
    ).toHaveLength(0);
    expect(validateProviderConfig(LLM_CONFIG_SCHEMA, 'vllm', {})).toHaveLength(
      0,
    );
  });

  it('bounds LLM temperature to 0-2', () => {
    const ok = validateProviderConfig(LLM_CONFIG_SCHEMA, 'openai', {
      model: 'gpt-4o-mini',
      temperature: 0.7,
    });
    expect(ok).toHaveLength(0);
    expect(
      validateProviderConfig(LLM_CONFIG_SCHEMA, 'openai', {
        model: 'gpt-4o-mini',
        temperature: 5,
      }),
    ).not.toHaveLength(0);
    expect(
      validateProviderConfig(LLM_CONFIG_SCHEMA, 'openai', {
        model: 'gpt-4o-mini',
        temperature: 'hot',
      }),
    ).not.toHaveLength(0);
  });

  it('matches the provider case-insensitively', () => {
    // scenario_voices stores 'GOOGLE'; stt_configs stores 'google'.
    expect(
      validateProviderConfig(STT_CONFIG_SCHEMA, 'GOOGLE', { model: 'chirp_2' }),
    ).toHaveLength(0);
  });
});
