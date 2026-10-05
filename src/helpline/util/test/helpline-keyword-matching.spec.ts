import { HELPLINE_SEED_RULES } from 'src/database/migrations/1975720000000-SeedHelplineRiskKeywords';
import {
  HelplineKeywordMatchType,
  HelplineRiskFlagLevel,
} from '../../constants/helpline.constants';
import {
  CompiledKeywordRule,
  compileKeywordRule,
  matchKeywordRules,
  strongestHit,
} from '../../service/helpline-risk-keyword.service';
import {
  findPhrase,
  normaliseForMatching,
  normalisePhrase,
} from '../helpline-text-normaliser';

const rule = (
  phrase: string,
  matchType: HelplineKeywordMatchType,
  level = HelplineRiskFlagLevel.HIGH,
  language = 'en',
): CompiledKeywordRule =>
  compileKeywordRule({ id: phrase, phrase, language, matchType, level });

/** The original substring a hit's offsets point at — what the listener sees as `signal`. */
const signalOf = (text: string, rules: CompiledKeywordRule[]) => {
  const hit = strongestHit(matchKeywordRules(text, rules));
  return hit ? text.slice(hit.start, hit.end) : null;
};

describe('helpline keyword matching', () => {
  describe('normalisation', () => {
    it('lowercases, turns punctuation into boundaries and collapses whitespace', () => {
      expect(normaliseForMatching('  I  want to DIE!!!  ').text).toBe(
        'i want to die',
      );
      expect(normaliseForMatching('kill-myself...now').text).toBe(
        'kill myself now',
      );
    });

    it('keeps Devanagari vowel signs and virama (Marks), so Indic words survive', () => {
      // A [^\p{L}\p{N}] strip would turn this into "आत महत य".
      expect(normalisePhrase('आत्महत्या')).toBe('आत्महत्या');
      expect(normalisePhrase('जीना नहीं चाहती')).toBe('जीना नहीं चाहती');
    });

    it('keeps Tamil and Kannada vowel signs', () => {
      expect(normalisePhrase('தற்கொலை')).toBe('தற்கொலை');
      expect(normalisePhrase('ಆತ್ಮಹತ್ಯೆ')).toBe('ಆತ್ಮಹತ್ಯೆ');
    });

    it('composes a Tamil two-part vowel sign typed decomposed (NFKC)', () => {
      const decomposed = 'தற்கொலை'; // ெ + ா instead of ொ
      expect(normalisePhrase(decomposed)).toBe(normalisePhrase('தற்கொலை'));
    });

    it('folds full-width Latin', () => {
      expect(normalisePhrase('ＳＵＩＣＩＤＥ')).toBe('suicide');
    });

    it('folds the Devanagari nukta and drops joiners inside a word', () => {
      expect(normalisePhrase('ख़ुदकुशी')).toBe(normalisePhrase('खुदकुशी'));
      expect(normalisePhrase('आत्म‌हत्या')).toBe(normalisePhrase('आत्महत्या'));
    });

    it('maps every normalised character back into the original string', () => {
      const original = 'Hey… I want to   END MY LIFE.';
      const n = normaliseForMatching(original);
      const at = n.text.indexOf('end my life');
      expect(
        original.slice(n.starts[at], n.ends[at + 'end my life'.length - 1]),
      ).toBe('END MY LIFE');
    });
  });

  describe('WORD matching (English)', () => {
    const rules = [rule('kill myself', HelplineKeywordMatchType.WORD)];

    it('matches whole words regardless of case and punctuation', () => {
      expect(signalOf('I just want to KILL MYSELF!!', rules)).toBe(
        'KILL MYSELF',
      );
      expect(signalOf('kill myself', rules)).toBe('kill myself');
    });

    it('does not match inside a longer word', () => {
      expect(signalOf('I have skill myselfie problems', rules)).toBeNull();
      expect(signalOf('skill myself', rules)).toBeNull();
    });

    it('matches a contraction written with a curly apostrophe', () => {
      const r = [rule("don't want to live", HelplineKeywordMatchType.WORD)];
      expect(signalOf('I don’t want to live anymore', r)).toBe(
        'don’t want to live',
      );
      expect(signalOf("I DON'T want to live", r)).toBe("DON'T want to live");
    });

    it('a short WORD rule does not fire on a word containing it (the "therapist" problem)', () => {
      const r = [rule('suicide', HelplineKeywordMatchType.WORD)];
      expect(signalOf('suicidebombing in the news', r)).toBeNull();
      expect(signalOf('thinking about suicide.', r)).toBe('suicide');
    });
  });

  describe('CONTAINS matching (Indic, romanised)', () => {
    it('finds a Devanagari stem inside an inflected word, with vowel signs intact', () => {
      const r = [
        rule(
          'आत्महत्या',
          HelplineKeywordMatchType.CONTAINS,
          HelplineRiskFlagLevel.HIGH,
          'hi',
        ),
      ];
      const text = 'मैं आत्महत्याओं के बारे में सोचता हूँ';
      expect(signalOf(text, r)).toBe('आत्महत्या');
    });

    it('matches across the nukta spelling difference', () => {
      const r = [
        rule(
          'खुदकुशी',
          HelplineKeywordMatchType.CONTAINS,
          HelplineRiskFlagLevel.HIGH,
          'hi',
        ),
      ];
      // The original body still carries the nukta; the signal is the whole word.
      expect(signalOf('मैं ख़ुदकुशी कर लूँगा', r)).toBe('ख़ुदकुशी');
    });

    it('matches a Devanagari phrase with spaces', () => {
      const r = [
        rule(
          'जीना नहीं चाहती',
          HelplineKeywordMatchType.CONTAINS,
          HelplineRiskFlagLevel.HIGH,
          'hi',
        ),
      ];
      expect(signalOf('अब मैं जीना नहीं चाहती।', r)).toBe('जीना नहीं चाहती');
    });

    it('matches romanised Hindi (Hinglish)', () => {
      const r = [
        rule(
          'marna chahta',
          HelplineKeywordMatchType.CONTAINS,
          HelplineRiskFlagLevel.HIGH,
          'hi',
        ),
      ];
      expect(signalOf('yaar main marna chahta hoon', r)).toBe('marna chahta');
      expect(signalOf('Main MARNA CHAHTA hu', r)).toBe('MARNA CHAHTA');
    });

    it('matches Tamil inside an agglutinated word', () => {
      const r = [
        rule(
          'தற்கொலை',
          HelplineKeywordMatchType.CONTAINS,
          HelplineRiskFlagLevel.HIGH,
          'ta',
        ),
      ];
      expect(signalOf('நான் தற்கொலைக்கு யோசிக்கிறேன்', r)).toBe('தற்கொலை');
    });

    it('CONTAINS is a substring match, WORD is not', () => {
      const text = 'overdosed';
      expect(
        findPhrase(
          normaliseForMatching(text),
          'overdose',
          HelplineKeywordMatchType.CONTAINS,
        ),
      ).not.toBeNull();
      expect(
        findPhrase(
          normaliseForMatching(text),
          'overdose',
          HelplineKeywordMatchType.WORD,
        ),
      ).toBeNull();
    });
  });

  describe('choosing the flag', () => {
    it('prefers HIGH over ELEVATED, then the earliest hit', () => {
      const rules = [
        rule(
          'self harm',
          HelplineKeywordMatchType.WORD,
          HelplineRiskFlagLevel.ELEVATED,
        ),
        rule(
          'want to die',
          HelplineKeywordMatchType.WORD,
          HelplineRiskFlagLevel.HIGH,
        ),
      ];
      const hit = strongestHit(
        matchKeywordRules('i self harm and i want to die', rules),
      );
      expect(hit?.rule.level).toBe(HelplineRiskFlagLevel.HIGH);
      expect(hit?.rule.phrase).toBe('want to die');
    });

    it('returns no hit for ordinary text', () => {
      const rules = HELPLINE_SEED_RULES.map((r, i) =>
        compileKeywordRule({ ...r, id: String(i) } as never),
      );
      expect(
        matchKeywordRules('I had a rough day at work and want to talk.', rules),
      ).toEqual([]);
    });
  });

  describe('the platform seed', () => {
    const compiled = HELPLINE_SEED_RULES.map((r, i) =>
      compileKeywordRule({ ...r, id: String(i) } as never),
    );

    it('every seeded phrase survives normalisation', () => {
      for (const r of compiled) expect(r.needle.length).toBeGreaterThan(0);
    });

    it.each([
      ['I want to kill myself', 'en'],
      ['honestly everyone would be better off without me', 'en'],
      ['मैं मरना चाहता हूँ', 'hi'],
      ['ab jeena nahi chahti', 'hi'],
      ['मला जगायचं नाही', 'mr'],
      ['எனக்கு சாக வேண்டும்', 'ta'],
      ['ನನಗೆ ಬದುಕಲು ಇಷ್ಟವಿಲ್ಲ', 'kn'],
    ])('flags "%s" (%s) as HIGH', (text) => {
      expect(strongestHit(matchKeywordRules(text, compiled))?.rule.level).toBe(
        HelplineRiskFlagLevel.HIGH,
      );
    });

    it('applies every language, so Devanagari in an English chat is still screened', () => {
      // matchKeywordRules has no language filter: rulesFor() loads them all.
      expect(
        strongestHit(matchKeywordRules('आत्महत्या', compiled)),
      ).not.toBeNull();
    });
  });
});
