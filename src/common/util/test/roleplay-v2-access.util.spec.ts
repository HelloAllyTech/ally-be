import {
  isRoleplayV2EmailAllowed,
  normalizeEmailForAllowlist,
} from '../roleplay-v2-access.util';

describe('roleplay-v2-access util', () => {
  const SANDEEP = 'sandeep.malhotra@helloally.ai';

  describe('normalizeEmailForAllowlist', () => {
    it('lower-cases and trims', () => {
      expect(normalizeEmailForAllowlist('  Foo@Bar.COM ')).toBe('foo@bar.com');
    });

    it('strips a +tag sub-address', () => {
      expect(
        normalizeEmailForAllowlist('sandeep.malhotra+admin@helloally.ai'),
      ).toBe(SANDEEP);
      expect(
        normalizeEmailForAllowlist('sandeep.malhotra+learner@helloally.ai'),
      ).toBe(SANDEEP);
    });

    it('returns empty for null/undefined/blank', () => {
      expect(normalizeEmailForAllowlist(null)).toBe('');
      expect(normalizeEmailForAllowlist(undefined)).toBe('');
      expect(normalizeEmailForAllowlist('   ')).toBe('');
    });
  });

  describe('isRoleplayV2EmailAllowed', () => {
    const cfgOn = { enabled: true, allowlist: [SANDEEP] };

    it('false when the flag is off, even for an allowlisted email', () => {
      expect(
        isRoleplayV2EmailAllowed(SANDEEP, {
          enabled: false,
          allowlist: [SANDEEP],
        }),
      ).toBe(false);
    });

    it('true for an allowlisted email when the flag is on', () => {
      expect(isRoleplayV2EmailAllowed(SANDEEP, cfgOn)).toBe(true);
    });

    it('true for +tag sub-addresses of an allowlisted base', () => {
      expect(
        isRoleplayV2EmailAllowed('sandeep.malhotra+admin@helloally.ai', cfgOn),
      ).toBe(true);
    });

    it('false for a non-allowlisted email', () => {
      expect(isRoleplayV2EmailAllowed('other@helloally.ai', cfgOn)).toBe(false);
    });

    it('false for empty email or missing config', () => {
      expect(isRoleplayV2EmailAllowed('', cfgOn)).toBe(false);
      expect(isRoleplayV2EmailAllowed(SANDEEP, null)).toBe(false);
      expect(isRoleplayV2EmailAllowed(SANDEEP, undefined)).toBe(false);
    });
  });
});
