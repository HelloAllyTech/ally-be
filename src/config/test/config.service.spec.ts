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
});
