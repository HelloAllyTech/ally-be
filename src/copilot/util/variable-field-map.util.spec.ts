import { GeneratableField } from 'src/learn/enum/generatable-field.enum';
import {
  extractAvailableVariableNames,
  planStructuredGeneration,
} from './variable-field-map.util';

describe('variable-field-map.util', () => {
  describe('extractAvailableVariableNames', () => {
    it('accepts bare-string and {name} object entries, trims, ignores blanks', () => {
      const names = extractAvailableVariableNames([
        'character_profile_text',
        { name: 'allowed_fillers', label: 'Fillers', required: false },
        '  linguistic_samples  ',
        { name: '   ' },
        '',
        // @ts-expect-error tolerant of malformed entries
        null,
      ]);
      expect(names).toEqual(
        new Set([
          'character_profile_text',
          'allowed_fillers',
          'linguistic_samples',
        ]),
      );
    });

    it('returns an empty set for null/undefined', () => {
      expect(extractAvailableVariableNames(null).size).toBe(0);
      expect(extractAvailableVariableNames(undefined).size).toBe(0);
    });
  });

  describe('planStructuredGeneration', () => {
    it('plans the default main_agent skill (no states, no knowledge)', () => {
      const vars = new Set([
        'character_profile_text',
        'challenge_description',
        'linguistic_samples',
        'allowed_fillers',
        'behavior_instructions_json',
      ]);
      const tiers = planStructuredGeneration(vars, false);
      // Tier 1 has the three independent fields; tier 2 (states/knowledge) is
      // dropped because neither is enabled.
      expect(tiers).toEqual([
        [
          GeneratableField.LINGUISTIC_STYLE_SAMPLES,
          GeneratableField.ALLOWED_FILLER_WORDS,
          GeneratableField.BEHAVIOR_INSTRUCTIONS,
        ],
      ]);
    });

    it('enables STATES via the hasStates flag and KNOWLEDGE via retrieved_context', () => {
      const vars = new Set(['behavior_instructions_json', 'retrieved_context']);
      const tiers = planStructuredGeneration(vars, true);
      expect(tiers).toEqual([
        [GeneratableField.BEHAVIOR_INSTRUCTIONS],
        [GeneratableField.STATES, GeneratableField.KNOWLEDGE_SOURCES],
      ]);
    });

    it('generates nothing when the skill maps no structured fields', () => {
      const vars = new Set(['title', 'role_instructions', 'competency']);
      expect(planStructuredGeneration(vars, false)).toEqual([]);
    });

    it('accepts helpful/unhelpful behaviour variables as behaviour triggers', () => {
      const tiers = planStructuredGeneration(
        new Set(['helpful_behaviours', 'unhelpful_behaviours']),
        false,
      );
      expect(tiers).toEqual([[GeneratableField.BEHAVIOR_INSTRUCTIONS]]);
    });
  });
});
