import { autogradeQuestion } from '../track-quiz.autograder';
import {
  FillBlankQuestion,
  MatchingQuestion,
  McqMultiQuestion,
  McqSingleQuestion,
  OrderingQuestion,
  QuizQuestionType,
  TrueFalseQuestion,
} from '../../type/quiz.type';

const mcqSingle: McqSingleQuestion = {
  id: 'q1',
  type: QuizQuestionType.MCQ_SINGLE,
  prompt: 'Pick one',
  points: 2,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correctOptionIds: ['a'],
};

const mcqMulti: McqMultiQuestion = {
  id: 'q2',
  type: QuizQuestionType.MCQ_MULTI,
  prompt: 'Pick many',
  points: 4,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
    { id: 'd', text: 'D' },
  ],
  correctOptionIds: ['a', 'c'],
};

const trueFalse: TrueFalseQuestion = {
  id: 'q3',
  type: QuizQuestionType.TRUE_FALSE,
  prompt: 'True?',
  correctAnswer: false,
};

const ordering: OrderingQuestion = {
  id: 'q4',
  type: QuizQuestionType.ORDERING,
  prompt: 'Order',
  points: 2,
  items: [
    { id: 'i1', text: '1' },
    { id: 'i2', text: '2' },
    { id: 'i3', text: '3' },
  ],
  correctOrder: ['i2', 'i1', 'i3'],
};

const matching: MatchingQuestion = {
  id: 'q5',
  type: QuizQuestionType.MATCHING,
  prompt: 'Match',
  points: 2,
  left: [
    { id: 'l1', text: 'L1' },
    { id: 'l2', text: 'L2' },
  ],
  right: [
    { id: 'r1', text: 'R1' },
    { id: 'r2', text: 'R2' },
    { id: 'r3', text: 'distractor' },
  ],
  correctPairs: [
    { leftId: 'l1', rightId: 'r1' },
    { leftId: 'l2', rightId: 'r2' },
  ],
};

const fillBlank: FillBlankQuestion = {
  id: 'q6',
  type: QuizQuestionType.FILL_BLANK,
  prompt: '',
  points: 2,
  template: 'Say {{b1}} then {{b2}}.',
  blanks: [
    { id: 'b1', acceptedAnswers: ['hello', 'hi'] },
    { id: 'b2', acceptedAnswers: ['Bye'], caseSensitive: true },
  ],
};

describe('autogradeQuestion', () => {
  it('grades an unanswered question as 0/incorrect', () => {
    const result = autogradeQuestion(mcqSingle, undefined);
    expect(result).toMatchObject({
      correct: false,
      pointsAwarded: 0,
      pointsPossible: 2,
    });
  });

  describe('mcq_single', () => {
    it('awards full points for the correct option', () => {
      const result = autogradeQuestion(mcqSingle, {
        questionId: 'q1',
        selectedOptionIds: ['a'],
      });
      expect(result).toMatchObject({ correct: true, pointsAwarded: 2 });
    });

    it('rejects multiple selections even if one is correct', () => {
      const result = autogradeQuestion(mcqSingle, {
        questionId: 'q1',
        selectedOptionIds: ['a', 'b'],
      });
      expect(result).toMatchObject({ correct: false, pointsAwarded: 0 });
    });
  });

  describe('mcq_multi (all-or-nothing default)', () => {
    it('awards full points for exact set match', () => {
      const result = autogradeQuestion(mcqMulti, {
        questionId: 'q2',
        selectedOptionIds: ['c', 'a'],
      });
      expect(result).toMatchObject({ correct: true, pointsAwarded: 4 });
    });

    it('awards zero for a partial match', () => {
      const result = autogradeQuestion(mcqMulti, {
        questionId: 'q2',
        selectedOptionIds: ['a'],
      });
      expect(result).toMatchObject({ correct: false, pointsAwarded: 0 });
    });

    it('applies partial credit with wrong-answer penalty when enabled', () => {
      const partial = { ...mcqMulti, partialCredit: true };
      // 2 correct chosen, 1 wrong chosen → (2-1)/2 = 0.5 → 2 points
      const result = autogradeQuestion(partial, {
        questionId: 'q2',
        selectedOptionIds: ['a', 'c', 'b'],
      });
      expect(result).toMatchObject({ correct: false, pointsAwarded: 2 });
    });

    it('partial credit never goes below zero', () => {
      const partial = { ...mcqMulti, partialCredit: true };
      const result = autogradeQuestion(partial, {
        questionId: 'q2',
        selectedOptionIds: ['b', 'd'],
      });
      expect(result).toMatchObject({ pointsAwarded: 0 });
    });
  });

  describe('true_false', () => {
    it('grades a correct boolean', () => {
      const result = autogradeQuestion(trueFalse, {
        questionId: 'q3',
        booleanAnswer: false,
      });
      expect(result).toMatchObject({ correct: true, pointsAwarded: 1 });
    });

    it('treats a missing boolean as incorrect', () => {
      const result = autogradeQuestion(trueFalse, { questionId: 'q3' });
      expect(result).toMatchObject({ correct: false });
    });
  });

  describe('ordering', () => {
    it('requires the exact sequence', () => {
      expect(
        autogradeQuestion(ordering, {
          questionId: 'q4',
          orderedItemIds: ['i2', 'i1', 'i3'],
        }),
      ).toMatchObject({ correct: true, pointsAwarded: 2 });
      expect(
        autogradeQuestion(ordering, {
          questionId: 'q4',
          orderedItemIds: ['i1', 'i2', 'i3'],
        }),
      ).toMatchObject({ correct: false, pointsAwarded: 0 });
    });
  });

  describe('matching', () => {
    it('awards partial credit per correct pair', () => {
      const result = autogradeQuestion(matching, {
        questionId: 'q5',
        pairs: [
          { leftId: 'l1', rightId: 'r1' },
          { leftId: 'l2', rightId: 'r3' },
        ],
      });
      expect(result).toMatchObject({ correct: false, pointsAwarded: 1 });
    });

    it('ignores duplicate left submissions', () => {
      const result = autogradeQuestion(matching, {
        questionId: 'q5',
        pairs: [
          { leftId: 'l1', rightId: 'r2' },
          { leftId: 'l1', rightId: 'r1' },
        ],
      });
      expect(result).toMatchObject({ pointsAwarded: 0 });
    });
  });

  describe('fill_blank', () => {
    it('is case-insensitive by default and case-sensitive when flagged', () => {
      const result = autogradeQuestion(fillBlank, {
        questionId: 'q6',
        blanks: [
          { blankId: 'b1', answer: '  HELLO ' },
          { blankId: 'b2', answer: 'bye' },
        ],
      });
      // b1 matches (case-insensitive + trim), b2 fails (case-sensitive)
      expect(result).toMatchObject({ correct: false, pointsAwarded: 1 });
    });

    it('awards full credit when every blank matches', () => {
      const result = autogradeQuestion(fillBlank, {
        questionId: 'q6',
        blanks: [
          { blankId: 'b1', answer: 'hi' },
          { blankId: 'b2', answer: 'Bye' },
        ],
      });
      expect(result).toMatchObject({ correct: true, pointsAwarded: 2 });
    });
  });

  it('leaves open-ended questions pending (correct: null)', () => {
    const result = autogradeQuestion(
      {
        id: 'q7',
        type: QuizQuestionType.OPEN_ENDED,
        prompt: 'Explain',
        points: 5,
        rubric: { guidance: 'g', maxScore: 5 },
      },
      { questionId: 'q7', text: 'my answer' },
    );
    expect(result).toMatchObject({
      correct: null,
      pointsAwarded: 0,
      pointsPossible: 5,
    });
  });
});
