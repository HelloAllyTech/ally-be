import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../config.service';

describe('AppConfigService', () => {
  const make = (env: Record<string, string>) => {
    const configService = {
      get: <T>(key: string, def?: T) => (key in env ? (env[key] as any) : def),
    } as unknown as ConfigService;
    return new AppConfigService(configService);
  };

  // Env values reach ConfigService as STRINGS (this key is not in the Joi
  // schema, so nothing coerces it). Guards against the `get<boolean>() ===
  // true` trap that read the env string 'true' as false in prod.
  describe('learnMetadataFetchEnabled', () => {
    it("is true for the env string 'true'", () => {
      expect(
        make({ LEARN_METADATA_FETCH_ENABLED: 'true' })
          .learnMetadataFetchEnabled,
      ).toBe(true);
    });

    it("is false for 'false' and when unset", () => {
      expect(
        make({ LEARN_METADATA_FETCH_ENABLED: 'false' })
          .learnMetadataFetchEnabled,
      ).toBe(false);
      expect(make({}).learnMetadataFetchEnabled).toBe(false);
    });
  });

  describe('translation', () => {
    it('defaults to Gemini 2.5 Flash with thinking off', () => {
      expect(make({}).translation).toEqual({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        maxTokens: 16384,
        thinkingBudget: 0,
      });
    });

    it('reads env overrides, which arrive as strings', () => {
      const t = make({
        TRANSLATION_THINKING_BUDGET: '-1',
        TRANSLATION_MAX_TOKENS: '8192',
      }).translation;
      expect(t.thinkingBudget).toBe(-1);
      expect(t.maxTokens).toBe(8192);
    });

    it('falls back to OPENAI_TRANSLATION_MODEL when the provider is openai', () => {
      expect(make({ TRANSLATION_PROVIDER: 'openai' }).translation.model).toBe(
        'gpt-4o-mini',
      );
    });
  });

  describe('googleAuth.clientIds', () => {
    it('combines the web, iOS and Android client ids', () => {
      expect(
        make({
          GOOGLE_WEB_CLIENT_ID: 'web',
          GOOGLE_IOS_CLIENT_ID: 'ios',
          GOOGLE_ANDROID_CLIENT_ID: 'android',
        }).googleAuth.clientIds,
      ).toEqual(['web', 'ios', 'android']);
    });

    it('accepts a comma-separated list in each and drops blanks', () => {
      expect(
        make({
          GOOGLE_WEB_CLIENT_ID: 'web-a, web-b,',
          GOOGLE_IOS_CLIENT_ID: 'ios',
        }).googleAuth.clientIds,
      ).toEqual(['web-a', 'web-b', 'ios']);
    });
  });
});
