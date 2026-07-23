import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../config.service';

/**
 * Pins the roleplayV2 rollout config: default-on flag, always-included tester,
 * and env parsing/normalization of the allowlist.
 */
describe('AppConfigService.roleplayV2', () => {
  const SANDEEP = 'sandeep.malhotra@helloally.ai';

  const make = (env: Record<string, string>) => {
    const configService = {
      get: <T>(key: string, def?: T) => (key in env ? (env[key] as any) : def),
    } as unknown as ConfigService;
    return new AppConfigService(configService);
  };

  it('defaults to enabled with sandeep always allowlisted', () => {
    const { enabled, allowlist } = make({}).roleplayV2;
    expect(enabled).toBe(true);
    expect(allowlist).toContain(SANDEEP);
    expect(allowlist).toContain('gopi.s@helloally.ai');
    expect(allowlist).toContain('gopikrishnan.sasikumar@helloally.ai');
  });

  it('is disabled only when ROLEPLAY_V2_ENABLED is exactly "false"', () => {
    expect(make({ ROLEPLAY_V2_ENABLED: 'false' }).roleplayV2.enabled).toBe(
      false,
    );
    expect(make({ ROLEPLAY_V2_ENABLED: 'true' }).roleplayV2.enabled).toBe(true);
  });

  it('parses ROLEPLAY_V2_ALLOWLIST (trim + lowercase + dedupe, sandeep kept)', () => {
    const { allowlist } = make({
      ROLEPLAY_V2_ALLOWLIST: ' Foo@Bar.com , baz@qux.io ,Foo@Bar.com',
    }).roleplayV2;
    expect(allowlist).toContain(SANDEEP);
    expect(allowlist).toContain('foo@bar.com');
    expect(allowlist).toContain('baz@qux.io');
    // deduped
    expect(allowlist.filter((e) => e === 'foo@bar.com')).toHaveLength(1);
  });

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
