import {
  parseBranchInstruction,
  parseClassifier,
  parseEventBuilderField,
  parseExamples,
  parseFeedback,
  parseTags,
} from '../event-builder-parse.util';
import {
  EventBuilderField,
  MAX_EXAMPLES_PER_POLARITY,
} from '../../enum/event-builder-field.enum';

/**
 * These parsers are the only thing standing between a model's answer and a
 * `session_events` row, so the cases here are the ones that would otherwise
 * reach the database: wrong shape, wrong types, out-of-range numbers, an
 * "emoji" that is a word, and an example the model filed under both polarities.
 *
 * The event catalogue has no tenant column, so a bad row is visible in every
 * tenant's picker — which is why every parser here is total, and why clamping
 * happens before the value is ever offered to the author.
 */
describe('event-builder-parse.util', () => {
  describe('parseClassifier', () => {
    it('reads the documented shape', () => {
      expect(
        parseClassifier(
          '{"name":"Open-Ended Question","className":"Open-ended question that invites the caller to expand"}',
        ),
      ).toEqual({
        name: 'Open-Ended Question',
        className: 'Open-ended question that invites the caller to expand',
      });
    });

    it('recovers a JSON object wrapped in prose', () => {
      const result = parseClassifier(
        'Sure! Here you go:\n{"name":"Premature Advice","className":"Advice offered before the caller has explained their situation"}\nHope that helps.',
      );
      expect(result.name).toBe('Premature Advice');
      expect(result.className).toContain('Advice offered before');
    });

    it('accepts snake_case class_name', () => {
      expect(parseClassifier('{"name":"A","class_name":"B"}').className).toBe(
        'B',
      );
    });

    it('back-fills whichever half the model omitted', () => {
      expect(parseClassifier('{"className":"Reflective summary"}').name).toBe(
        'Reflective summary',
      );
      expect(parseClassifier('{"name":"Reflective summary"}').className).toBe(
        'Reflective summary',
      );
    });

    it('strips wrapping quotes and collapses newlines to one line', () => {
      expect(parseClassifier('{"name":"\\"Open\\nQuestion\\""}').name).toBe(
        'Open Question',
      );
    });

    it('returns blanks rather than throwing on unparseable output', () => {
      expect(parseClassifier('I cannot help with that.')).toEqual({
        name: '',
        className: '',
      });
    });
  });

  describe('parseExamples', () => {
    const raw = JSON.stringify({
      positiveExamples: [
        { text: 'What was that like for you?' },
        { text: 'Tell me more about how things have been at home.' },
      ],
      negativeExamples: [{ text: "So you're feeling anxious, is that right?" }],
    });

    it('reads the documented shape', () => {
      expect(parseExamples(raw, 4)).toEqual({
        positiveExamples: [
          { text: 'What was that like for you?' },
          { text: 'Tell me more about how things have been at home.' },
        ],
        negativeExamples: [
          { text: "So you're feeling anxious, is that right?" },
        ],
      });
    });

    it('accepts bare strings and snake_case keys', () => {
      expect(
        parseExamples(
          '{"positive_examples":["What brought you here?"],"negative_examples":["Are you okay?"]}',
        ),
      ).toEqual({
        positiveExamples: [{ text: 'What brought you here?' }],
        negativeExamples: [{ text: 'Are you okay?' }],
      });
    });

    it('caps each polarity at the requested count', () => {
      const many = JSON.stringify({
        positiveExamples: ['a', 'b', 'c', 'd', 'e', 'f'].map((t) => ({
          text: `question ${t}`,
        })),
        negativeExamples: [],
      });
      expect(parseExamples(many, 2).positiveExamples).toHaveLength(2);
    });

    it('never exceeds the hard per-polarity ceiling, whatever is asked for', () => {
      const many = JSON.stringify({
        positiveExamples: Array.from({ length: 20 }, (_, i) => ({
          text: `question number ${i}`,
        })),
      });
      expect(parseExamples(many, 99).positiveExamples).toHaveLength(
        MAX_EXAMPLES_PER_POLARITY,
      );
    });

    it('drops a text the model filed under BOTH polarities, from both lists', () => {
      const contradictory = JSON.stringify({
        positiveExamples: [
          { text: 'How are you feeling?' },
          { text: 'Say more.' },
        ],
        negativeExamples: [{ text: 'how are you FEELING?' }],
      });
      const result = parseExamples(contradictory);
      expect(result.positiveExamples).toEqual([{ text: 'Say more.' }]);
      expect(result.negativeExamples).toEqual([]);
    });

    it('de-duplicates within a polarity, case-insensitively', () => {
      const dupes = JSON.stringify({
        positiveExamples: [{ text: 'Say more.' }, { text: 'say MORE.' }],
      });
      expect(parseExamples(dupes).positiveExamples).toEqual([
        { text: 'Say more.' },
      ]);
    });

    it('does not guess which array is which when neither key is present', () => {
      // A single unnamed array could be either polarity, and filing negatives
      // as positives would poison the classifier silently.
      expect(parseExamples('{"examples":["What brought you here?"]}')).toEqual({
        positiveExamples: [],
        negativeExamples: [],
      });
    });

    it('returns empty lists on unparseable output', () => {
      expect(parseExamples('no json here')).toEqual({
        positiveExamples: [],
        negativeExamples: [],
      });
    });
  });

  describe('parseFeedback', () => {
    it('reads the documented shape', () => {
      expect(
        parseFeedback(
          '{"message":"You gave them room to say more","emoji":"👏","score":5}',
        ),
      ).toEqual({
        message: 'You gave them room to say more',
        emoji: '👏',
        score: 5,
      });
    });

    it('keeps a negative score for a behaviour to discourage', () => {
      expect(parseFeedback('{"message":"m","score":-4}').score).toBe(-4);
    });

    it('coerces and rounds a stringified score', () => {
      expect(parseFeedback('{"message":"m","score":"3.6"}').score).toBe(4);
    });

    it('clamps a score outside the event scale', () => {
      expect(parseFeedback('{"message":"m","score":9999}').score).toBe(100);
      expect(parseFeedback('{"message":"m","score":-9999}').score).toBe(-100);
    });

    it('falls back to 0 when the score is not a number', () => {
      expect(parseFeedback('{"message":"m","score":"high"}').score).toBe(0);
      expect(parseFeedback('{"message":"m"}').score).toBe(0);
    });

    it('drops an "emoji" that is a word or a shortcode', () => {
      expect(
        parseFeedback('{"message":"m","emoji":"thumbs up"}').emoji,
      ).toBeUndefined();
      expect(
        parseFeedback('{"message":"m","emoji":":smile:"}').emoji,
      ).toBeUndefined();
      expect(parseFeedback('{"message":"m","emoji":""}').emoji).toBeUndefined();
    });

    it('keeps a multi-codepoint emoji intact', () => {
      expect(parseFeedback('{"message":"m","emoji":"👩‍⚕️"}').emoji).toBe('👩‍⚕️');
    });
  });

  describe('parseBranchInstruction', () => {
    it('returns plain text as-is', () => {
      expect(
        parseBranchInstruction(
          '  You open up a little and offer one more detail.  ',
        ),
      ).toBe('You open up a little and offer one more detail.');
    });

    it('unwraps a model that answered with JSON anyway', () => {
      expect(
        parseBranchInstruction('{"branchInstruction":"You become guarded."}'),
      ).toBe('You become guarded.');
      expect(
        parseBranchInstruction('{"branch_instruction":"You become guarded."}'),
      ).toBe('You become guarded.');
    });
  });

  describe('parseTags', () => {
    it('reads the documented shape', () => {
      expect(parseTags('{"tags":["active-listening","questioning"]}')).toEqual([
        'active-listening',
        'questioning',
      ]);
    });

    it('accepts an array under an unexpected key', () => {
      expect(parseTags('{"anything":["questioning"]}')).toEqual([
        'questioning',
      ]);
    });

    it('de-duplicates case-insensitively and caps the count', () => {
      expect(parseTags('{"tags":["a","A","b","c","d","e","f","g"]}')).toEqual([
        'a',
        'b',
        'c',
        'd',
        'e',
      ]);
    });

    it('returns an empty list on unparseable output', () => {
      expect(parseTags('none')).toEqual([]);
    });
  });

  describe('parseEventBuilderField', () => {
    it('routes each field to its parser', () => {
      expect(
        parseEventBuilderField(EventBuilderField.CLASSIFIER, '{"name":"N"}'),
      ).toEqual({ name: 'N', className: 'N' });
      expect(
        parseEventBuilderField(EventBuilderField.TAGS, '{"tags":["x"]}'),
      ).toEqual(['x']);
      expect(
        parseEventBuilderField(EventBuilderField.BRANCH_INSTRUCTION, 'text'),
      ).toBe('text');
    });

    it('passes the example count through to the examples parser', () => {
      const raw = JSON.stringify({
        positiveExamples: [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
      });
      const value = parseEventBuilderField(
        EventBuilderField.EXAMPLES,
        raw,
        1,
      ) as { positiveExamples: unknown[] };
      expect(value.positiveExamples).toHaveLength(1);
    });
  });
});
