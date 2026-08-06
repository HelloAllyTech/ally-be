import { shouldServeMultilingual } from '../scenario.util';

describe('shouldServeMultilingual', () => {
  const hindi = { id: 2, translationCode: 'hi' };
  const english = { id: 1, translationCode: 'en' };

  it('serves multilingual when the language is opted in', () => {
    expect(shouldServeMultilingual(hindi, { '2': 'MULTILINGUAL' })).toBe(true);
  });

  it('serves English when the language is set to GENERIC', () => {
    expect(shouldServeMultilingual(hindi, { '2': 'GENERIC' })).toBe(false);
  });

  it('serves MULTILINGUAL when the language has no entry (new default)', () => {
    // Default-ON rollout: a missing entry now means multilingual; the
    // per-prompt overlay still falls back to English for anything
    // untranslated, so the worst case equals the old behavior.
    expect(shouldServeMultilingual(hindi, { '6': 'MULTILINGUAL' })).toBe(true);
    expect(shouldServeMultilingual(hindi, {})).toBe(true);
    expect(shouldServeMultilingual(hindi, undefined)).toBe(true);
  });

  it('an explicit GENERIC entry opts the language out', () => {
    expect(shouldServeMultilingual(hindi, { '2': 'GENERIC' })).toBe(false);
  });

  it('never serves multilingual for the source (English) language', () => {
    expect(shouldServeMultilingual(english, { '1': 'MULTILINGUAL' })).toBe(
      false,
    );
  });

  it('serves English when languageDetails is missing/unknown', () => {
    expect(shouldServeMultilingual(null, { '2': 'MULTILINGUAL' })).toBe(false);
    expect(shouldServeMultilingual(undefined, { '2': 'MULTILINGUAL' })).toBe(
      false,
    );
    expect(shouldServeMultilingual({}, { '2': 'MULTILINGUAL' })).toBe(false);
  });

  it('only honors the exact session language id for opt-outs', () => {
    // Tamil session (id 6) opted OUT, but Hindi session keeps the
    // multilingual default.
    const variant = { '6': 'GENERIC' as const };
    expect(
      shouldServeMultilingual({ id: 6, translationCode: 'ta' }, variant),
    ).toBe(false);
    expect(shouldServeMultilingual(hindi, variant)).toBe(true);
  });
});
