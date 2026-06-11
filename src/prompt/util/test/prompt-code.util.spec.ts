import { toPromptCode, standardizePromptCode } from '../prompt-code.util';

/**
 * toPromptCode must match PromptsSyncService convention:
 * subdir/filename.txt -> subdir_filename
 */
describe('prompt-code.util', () => {
  describe('toPromptCode', () => {
    it('concatenates subdir and filename with underscore', () => {
      expect(toPromptCode('openai_translation', 'code_mixed_system')).toBe(
        'openai_translation_code_mixed_system',
      );
    });

    it('matches actual prompt file paths in src/prompts/', () => {
      const folderToCodes: Array<[string, string]> = [
        ['openai_translation', 'code_mixed_system'],
        ['openai_translation', 'speech_reexpression_user'],
        ['openai_translation', 'learn_behavior_instruction'],
        ['openai_translation', 'session_event'],
        ['openai_translation', 'general_text_translation'],
        ['openai_simulation', 'states_instructions'],
        ['openai_simulation', 'opening_dialogues'],
        ['openai_simulation', 'challenge_description'],
        ['openai_simulation', 'character_profile_text'],
        ['openai_simulation', 'behavior_instructions'],
        ['openai_simulation', 'linguistic_style_samples'],
        ['openai_simulation', 'linguistic_style_samples_english'],
        ['openai_simulation', 'allowed_filler_words'],
        ['openai_simulation', 'allowed_filler_words_english'],
      ];

      for (const [subdir, filename] of folderToCodes) {
        const expected = `${subdir}_${filename}`;
        expect(toPromptCode(subdir, filename)).toBe(expected);
      }
    });
  });

  describe('standardizePromptCode', () => {
    it('converts to lowercase with underscores', () => {
      expect(standardizePromptCode('AI Learn')).toBe('ai_learn');
      expect(standardizePromptCode('learn prompt')).toBe('learn_prompt');
    });

    it('removes leading/trailing underscores', () => {
      expect(standardizePromptCode('  my_prompt  ')).toBe('my_prompt');
    });
  });
});
