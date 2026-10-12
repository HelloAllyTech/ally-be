import {
  buildAvailableLanguagesMap,
  getDistinctScenarioLanguageIds,
  getDistinctScenarioVoiceIds,
  getLanguageVoiceIds,
} from '../language-availability.util';

describe('language-availability.util', () => {
  describe('getLanguageVoiceIds', () => {
    it('should return an empty array when languageVoices is undefined', () => {
      const result = getLanguageVoiceIds(undefined);

      expect(result).toEqual([]);
    });

    it('should return an empty array when languageVoices is null', () => {
      const result = getLanguageVoiceIds(null);

      expect(result).toEqual([]);
    });

    it('should return an empty array when languageVoices is an empty object', () => {
      const result = getLanguageVoiceIds({});

      expect(result).toEqual([]);
    });

    it('should return numeric language ids parsed from object keys', () => {
      const result = getLanguageVoiceIds({
        '1': 'voice-a',
        '2': 'voice-b',
        '3': 'voice-c',
      });

      expect(result).toEqual([1, 2, 3]);
    });

    it('should filter out keys that are not valid integers', () => {
      const result = getLanguageVoiceIds({
        '1': 'voice-a',
        abc: 'voice-b',
        '2.5': 'voice-c',
        '3': 'voice-d',
      });

      expect(result).toEqual([1, 3]);
    });

    it('should filter out entries whose value is null', () => {
      const result = getLanguageVoiceIds({
        '1': 'voice-a',
        '2': null,
        '3': 'voice-c',
      });

      expect(result).toEqual([1, 3]);
    });

    it('should filter out entries whose value is undefined', () => {
      const result = getLanguageVoiceIds({
        '1': 'voice-a',
        '2': undefined,
        '3': 'voice-c',
      });

      expect(result).toEqual([1, 3]);
    });

    it('should keep entries whose value is a falsy non-null primitive like an empty string', () => {
      const result = getLanguageVoiceIds({
        '1': '',
        '2': 0,
        '3': false,
      });

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle a mix of valid and invalid entries', () => {
      const result = getLanguageVoiceIds({
        '10': { id: 'voice-x' },
        bad: 'voice-y',
        '20': null,
        '30': 'voice-z',
      });

      expect(result).toEqual([10, 30]);
    });
  });

  describe('getLanguageVoiceIds with activeVoices', () => {
    const activeVoices = new Map([
      ['en-voice', 1],
      ['hi-voice', 2],
    ]);

    it('keeps only languages whose voice is an active voice for that language', () => {
      const result = getLanguageVoiceIds(
        { '1': 'en-voice', '2': 'hi-voice', '8': 'retired-kn-voice' },
        activeVoices,
      );

      expect(result).toEqual([1, 2]);
    });

    it('drops a mapping whose voice belongs to a different language', () => {
      const result = getLanguageVoiceIds({ '8': 'en-voice' }, activeVoices);

      expect(result).toEqual([]);
    });

    it('drops non-string voice values when filtering', () => {
      const result = getLanguageVoiceIds(
        { '1': '', '2': 0, '3': { id: 'en-voice' } },
        activeVoices,
      );

      expect(result).toEqual([]);
    });

    it('applies the filter inside getDistinctScenarioLanguageIds too', () => {
      const result = getDistinctScenarioLanguageIds(
        [
          { metadata: { languageVoices: { '1': 'en-voice', '8': 'gone' } } },
          { scenario_metadata: { languageVoices: { '2': 'hi-voice' } } },
        ],
        activeVoices,
      );

      expect(result).toEqual([1, 2]);
    });
  });

  describe('getDistinctScenarioVoiceIds', () => {
    it('collects every string voice id once across both metadata shapes', () => {
      const result = getDistinctScenarioVoiceIds([
        { metadata: { languageVoices: { '1': 'a', '2': 'b', '3': null } } },
        { scenario_metadata: { languageVoices: { '2': 'b', '4': '' } } },
        {},
      ]);

      expect(result).toEqual(['a', 'b']);
    });
  });

  describe('getDistinctScenarioLanguageIds', () => {
    it('should return an empty array when scenarios is empty', () => {
      const result = getDistinctScenarioLanguageIds([]);

      expect(result).toEqual([]);
    });

    it('should collect ids from scenario.metadata.languageVoices', () => {
      const result = getDistinctScenarioLanguageIds([
        {
          metadata: {
            languageVoices: { '1': 'voice-a', '2': 'voice-b' },
          },
        },
      ]);

      expect(result).toEqual([1, 2]);
    });

    it('should fall back to scenario.scenario_metadata.languageVoices when metadata is absent', () => {
      const result = getDistinctScenarioLanguageIds([
        {
          scenario_metadata: {
            languageVoices: { '5': 'voice-e' },
          },
        },
      ]);

      expect(result).toEqual([5]);
    });

    it('should prefer metadata.languageVoices over scenario_metadata.languageVoices', () => {
      const result = getDistinctScenarioLanguageIds([
        {
          metadata: {
            languageVoices: { '1': 'voice-a' },
          },
          scenario_metadata: {
            languageVoices: { '99': 'voice-z' },
          },
        },
      ]);

      expect(result).toEqual([1]);
    });

    it('should deduplicate ids across scenarios', () => {
      const result = getDistinctScenarioLanguageIds([
        { metadata: { languageVoices: { '1': 'a', '2': 'b' } } },
        { metadata: { languageVoices: { '2': 'b', '3': 'c' } } },
        { scenario_metadata: { languageVoices: { '3': 'c', '4': 'd' } } },
      ]);

      expect(result).toEqual([1, 2, 3, 4]);
    });

    it('should ignore scenarios with no languageVoices in either field', () => {
      const result = getDistinctScenarioLanguageIds([
        {},
        { metadata: {} },
        { scenario_metadata: {} },
        { metadata: { languageVoices: { '7': 'voice-g' } } },
      ]);

      expect(result).toEqual([7]);
    });

    it('should skip entries whose voice value is null or undefined', () => {
      const result = getDistinctScenarioLanguageIds([
        {
          metadata: {
            languageVoices: { '1': 'a', '2': null, '3': undefined },
          },
        },
      ]);

      expect(result).toEqual([1]);
    });
  });

  describe('buildAvailableLanguagesMap', () => {
    it('should return an empty map when given no languages', () => {
      const result = buildAvailableLanguagesMap([]);

      expect(result.size).toBe(0);
    });

    it('should map each language by id to an AvailableLanguageItem', () => {
      const result = buildAvailableLanguagesMap([
        { id: 1, label: 'English', value: 'en' },
        { id: 2, label: 'Spanish', value: 'es' },
      ]);

      expect(result.size).toBe(2);
      expect(result.get(1)).toEqual({
        language_id: 1,
        label: 'English',
        value: 'en',
      });
      expect(result.get(2)).toEqual({
        language_id: 2,
        label: 'Spanish',
        value: 'es',
      });
    });

    it('should keep the last entry when language ids collide', () => {
      const result = buildAvailableLanguagesMap([
        { id: 1, label: 'English', value: 'en' },
        { id: 1, label: 'English (US)', value: 'en-US' },
      ]);

      expect(result.size).toBe(1);
      expect(result.get(1)).toEqual({
        language_id: 1,
        label: 'English (US)',
        value: 'en-US',
      });
    });
  });
});
