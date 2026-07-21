import {
  extractPlaceholders,
  extractAudioTags,
  validateTranslationTokens,
} from '../translation-token-guard.util';

describe('translation-token-guard', () => {
  describe('extractPlaceholders', () => {
    it('captures single-brace {word} tokens, with duplicates, in order', () => {
      expect(
        extractPlaceholders('Hi {name}, you are {age}. Bye {name}.'),
      ).toEqual(['{name}', '{age}', '{name}']);
    });

    it('ignores literal JSON braces and numeric-leading braces', () => {
      expect(extractPlaceholders('config {"key": "value"} and {123}')).toEqual(
        [],
      );
    });
  });

  describe('extractAudioTags', () => {
    it('captures lowercase bracketed tags', () => {
      expect(extractAudioTags('Say hi [laughs] then [sigh].')).toEqual([
        '[laughs]',
        '[sigh]',
      ]);
    });

    it('ignores capitalized bracket text (headings / markdown links)', () => {
      expect(extractAudioTags('See [Section 2] and [Click here](url)')).toEqual(
        [],
      );
    });
  });

  describe('validateTranslationTokens', () => {
    const cases: {
      name: string;
      source: string;
      output: string;
      ok: boolean;
      missing?: string[];
      added?: string[];
    }[] = [
      {
        name: 'exact match passes',
        source: 'You are {name}, aged {age}. [laughs]',
        output: 'आप {name} हैं, आयु {age}. [laughs]',
        ok: true,
      },
      {
        name: 'reordered tokens pass (multiset, not sequence)',
        source: 'first {a} then {b}',
        output: 'पहले {b} फिर {a}',
        ok: true,
      },
      {
        name: 'missing placeholder fails',
        source: 'Hello {name} and {age}',
        output: 'नमस्ते {name}',
        ok: false,
        missing: ['{age}'],
      },
      {
        name: 'added/hallucinated placeholder fails',
        source: 'Hello {name}',
        output: 'नमस्ते {name} {gender}',
        ok: false,
        added: ['{gender}'],
      },
      {
        name: 'renamed placeholder fails (missing + added)',
        source: 'Hello {name}',
        output: 'नमस्ते {naam}',
        ok: false,
        missing: ['{name}'],
        added: ['{naam}'],
      },
      {
        name: 'duplicate count matters — dropping one of two fails',
        source: 'Hi {name}, bye {name}',
        output: 'नमस्ते {name}',
        ok: false,
        missing: ['{name}'],
      },
      {
        name: 'dropped audio tag fails',
        source: 'ok [laughs]',
        output: 'ठीक है',
        ok: false,
      },
    ];

    cases.forEach((c) => {
      it(c.name, () => {
        const result = validateTranslationTokens(c.source, c.output);
        expect(result.ok).toBe(c.ok);
        if (c.missing) {
          expect(result.placeholders.missing).toEqual(c.missing);
        }
        if (c.added) {
          expect(result.placeholders.added).toEqual(c.added);
        }
      });
    });
  });
});
