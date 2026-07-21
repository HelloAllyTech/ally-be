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

  it('serves English when the language has no entry (default)', () => {
    expect(shouldServeMultilingual(hindi, { '6': 'MULTILINGUAL' })).toBe(false);
    expect(shouldServeMultilingual(hindi, {})).toBe(false);
    expect(shouldServeMultilingual(hindi, undefined)).toBe(false);
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

  it('only honors the exact session language id', () => {
    // Tamil session (id 6) opted in, but Hindi session must stay English.
    const variant = { '6': 'MULTILINGUAL' as const };
    expect(
      shouldServeMultilingual({ id: 6, translationCode: 'ta' }, variant),
    ).toBe(true);
    expect(shouldServeMultilingual(hindi, variant)).toBe(false);
  });
});
