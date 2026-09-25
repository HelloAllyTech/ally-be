import { BadRequestException } from '@nestjs/common';
import { autogradeQuestion, scoreQuizAttempt } from '../track-quiz.autograder';
import { sanitizeQuizForLearner } from '../track-quiz.sanitizer';
import { buildQuestionResult } from '../track-quiz.service';
import {
  computeStructuralSignature,
  validateTrackStructure,
} from '../track-structure.validator';
import {
  correctAnswerOf,
  hasAnswerKey,
  isQuestionGraded,
} from '../../util/track-quiz-grading.util';
import {
  LikertScaleQuestion,
  McqSingleQuestion,
  OpenEndedQuestion,
  QuizContent,
  QuizQuestionType,
  TrueFalseQuestion,
} from '../../type/quiz.type';
import { TrackItemType } from '../../type/track.type';
import { UpsertTrackSectionDto } from '../../dto/upsert-track-structure.dto';

const likert: LikertScaleQuestion = {
  id: 'lk',
  type: QuizQuestionType.LIKERT_SCALE,
  prompt: 'How do you feel about the session?',
  statements: [
    { id: 's1', text: 'I felt prepared' },
    { id: 's2', text: 'The caller felt heard' },
  ],
  scale: [
    { id: 'p1', text: 'Strongly disagree' },
    { id: 'p2', text: 'Disagree' },
    { id: 'p3', text: 'Neutral' },
    { id: 'p4', text: 'Agree' },
    { id: 'p5', text: 'Strongly agree' },
  ],
};

const mcq: McqSingleQuestion = {
  id: 'mcq',
  type: QuizQuestionType.MCQ_SINGLE,
  prompt: 'Pick one',
  points: 2,
  options: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correctOptionIds: ['a'],
};

const trueFalse: TrueFalseQuestion = {
  id: 'tf',
  type: QuizQuestionType.TRUE_FALSE,
  prompt: 'Sky is blue',
  points: 2,
  correctAnswer: true,
};

describe('isQuestionGraded / hasAnswerKey', () => {
  it('treats a question with no isGraded field as graded', () => {
    expect(isQuestionGraded(mcq)).toBe(true);
  });

  it('never grades a Likert question, whatever isGraded says', () => {
    expect(isQuestionGraded({ ...likert, isGraded: true })).toBe(false);
    expect(hasAnswerKey(likert)).toBe(false);
  });

  it('sees no key on an ungraded MCQ with no correct option', () => {
    const q = { ...mcq, isGraded: false, correctOptionIds: [] } as any;
    expect(hasAnswerKey(q)).toBe(false);
  });

  it('sees no key on an ungraded open-ended question even with a rubric', () => {
    const q: OpenEndedQuestion = {
      id: 'oe',
      type: QuizQuestionType.OPEN_ENDED,
      prompt: 'Reflect',
      isGraded: false,
      rubric: { guidance: 'anything', maxScore: 5 },
    };
    expect(hasAnswerKey(q)).toBe(false);
  });
});

describe('autogradeQuestion - ungraded', () => {
  it('records a Likert answer as ungraded, with no verdict and no points', () => {
    const grading = autogradeQuestion(likert, {
      questionId: 'lk',
      ratings: [{ statementId: 's1', scaleOptionId: 'p4' }],
    });
    expect(grading).toEqual({
      questionId: 'lk',
      correct: null,
      pointsAwarded: 0,
      pointsPossible: 0,
      graded: false,
    });
  });

  it('still marks an ungraded question that kept its key right or wrong', () => {
    const q = { ...trueFalse, isGraded: false };
    expect(
      autogradeQuestion(q, { questionId: 'tf', booleanAnswer: true }),
    ).toMatchObject({ correct: true, pointsAwarded: 0, pointsPossible: 0 });
    expect(
      autogradeQuestion(q, { questionId: 'tf', booleanAnswer: false }),
    ).toMatchObject({ correct: false, pointsAwarded: 0, graded: false });
  });

  it('gives an ungraded question with no key no verdict', () => {
    const q = { ...trueFalse, isGraded: false, correctAnswer: undefined };
    expect(
      autogradeQuestion(q as any, { questionId: 'tf', booleanAnswer: true }),
    ).toMatchObject({ correct: null, graded: false });
  });

  it('leaves graded questions exactly as before (no graded key)', () => {
    expect(
      autogradeQuestion(mcq, { questionId: 'mcq', selectedOptionIds: ['a'] }),
    ).toEqual({
      questionId: 'mcq',
      correct: true,
      pointsAwarded: 2,
      pointsPossible: 2,
    });
  });
});

describe('scoreQuizAttempt', () => {
  it('scores a mixed quiz on its graded questions only', () => {
    const grading = [
      autogradeQuestion(mcq, { questionId: 'mcq', selectedOptionIds: ['a'] }),
      autogradeQuestion(
        { ...trueFalse, isGraded: false },
        { questionId: 'tf', booleanAnswer: false },
      ),
      autogradeQuestion(likert, { questionId: 'lk', ratings: [] }),
    ];
    // 2/2 on the only graded question — the wrong ungraded answer and the
    // Likert move nothing.
    expect(scoreQuizAttempt(grading, 70, false)).toEqual({
      scorePct: 100,
      passed: true,
    });
  });

  it('fails a mixed quiz on its graded questions only', () => {
    const grading = [
      autogradeQuestion(mcq, { questionId: 'mcq', selectedOptionIds: ['b'] }),
      autogradeQuestion(
        { ...trueFalse, isGraded: false },
        { questionId: 'tf', booleanAnswer: true },
      ),
    ];
    expect(scoreQuizAttempt(grading, 70, false)).toEqual({
      scorePct: 0,
      passed: false,
    });
  });

  it('gives a quiz of only ungraded questions no score and passes it', () => {
    const grading = [
      autogradeQuestion(likert, { questionId: 'lk', ratings: [] }),
      autogradeQuestion(
        { ...mcq, isGraded: false },
        { questionId: 'mcq', selectedOptionIds: ['b'] },
      ),
    ];
    // Nothing to fail, so a survey never strands the learner behind a pass
    // score they cannot reach.
    expect(scoreQuizAttempt(grading, 70, false)).toEqual({
      scorePct: null,
      passed: true,
    });
  });

  it('counts pre-existing grading entries with no graded field', () => {
    const legacy = [
      { questionId: 'x', correct: true, pointsAwarded: 1, pointsPossible: 1 },
      { questionId: 'y', correct: false, pointsAwarded: 0, pointsPossible: 1 },
    ];
    expect(scoreQuizAttempt(legacy, 50, false)).toEqual({
      scorePct: 50,
      passed: true,
    });
  });

  it('holds passed at null while grading is pending', () => {
    const grading = [
      autogradeQuestion(mcq, { questionId: 'mcq', selectedOptionIds: ['a'] }),
    ];
    expect(scoreQuizAttempt(grading, 70, true).passed).toBeNull();
  });
});

describe('buildQuestionResult - showCorrectAnswer', () => {
  const entry = autogradeQuestion(mcq, {
    questionId: 'mcq',
    selectedOptionIds: ['b'],
  });

  it('sends the answer key by default', () => {
    expect(buildQuestionResult(entry, mcq, true)).toMatchObject({
      correct: false,
      graded: true,
      correctAnswer: { selectedOptionIds: ['a'] },
    });
  });

  it('withholds the answer key but keeps the verdict when hidden', () => {
    const result = buildQuestionResult(
      entry,
      { ...mcq, showCorrectAnswer: false },
      true,
    );
    expect(result).not.toHaveProperty('correctAnswer');
    expect(result.correct).toBe(false);
    expect(JSON.stringify(result)).not.toContain('"a"');
  });

  it('sends fill-blank accepted answers per blank', () => {
    const q = {
      id: 'fb',
      type: QuizQuestionType.FILL_BLANK,
      prompt: '',
      template: 'The {{b1}} is blue',
      blanks: [{ id: 'b1', acceptedAnswers: ['sky', 'heaven'] }],
    } as any;
    const e = autogradeQuestion(q, {
      questionId: 'fb',
      blanks: [{ blankId: 'b1', answer: 'sea' }],
    });
    expect(buildQuestionResult(e, q, false).correctAnswer).toEqual({
      blanks: [{ blankId: 'b1', acceptedAnswers: ['sky', 'heaven'] }],
    });
  });

  it('has nothing to reveal for a Likert question', () => {
    const e = autogradeQuestion(likert, { questionId: 'lk', ratings: [] });
    const result = buildQuestionResult(e, likert, true);
    expect(result).not.toHaveProperty('correctAnswer');
    expect(result.graded).toBe(false);
  });

  it('never reveals a key for an ungraded question with none', () => {
    const q = { ...mcq, isGraded: false, correctOptionIds: [] } as any;
    expect(correctAnswerOf(q)).toBeNull();
  });
});

describe('sanitizeQuizForLearner - Likert and ungraded', () => {
  const quiz: QuizContent = {
    settings: { passScore: 70, shuffleOptions: true },
    questions: [mcq, { ...trueFalse, isGraded: false }, likert],
  };

  it('counts only graded questions in totalPoints', () => {
    expect(sanitizeQuizForLearner(quiz, 'seed').totalPoints).toBe(2);
  });

  it('marks ungraded questions and zeroes their points', () => {
    const [, tf, lk] = sanitizeQuizForLearner(quiz, 'seed').questions;
    expect(tf).toMatchObject({ graded: false, points: 0 });
    expect(lk).toMatchObject({ graded: false, points: 0 });
  });

  it('sends Likert statements and scale in authored order', () => {
    const lk = sanitizeQuizForLearner(quiz, 'seed').questions[2];
    expect(lk.statements).toEqual(likert.statements);
    expect(lk.scale).toEqual(likert.scale);
  });

  it('never sends the flags themselves or a key', () => {
    const payload = JSON.stringify(sanitizeQuizForLearner(quiz, 'seed'));
    expect(payload).not.toContain('correctAnswer');
    expect(payload).not.toContain('correctOptionIds');
    expect(payload).not.toContain('isGraded');
  });
});

function sectionWith(item: any): UpsertTrackSectionDto[] {
  return [{ id: 's1', title: 'S', order: 1, items: [{ id: 'i1', ...item }] }];
}

function quizWith(questions: any[]) {
  return {
    type: TrackItemType.QUIZ,
    order: 1,
    title: 'Quiz',
    content: { settings: { passScore: 70 }, questions },
  };
}

describe('validateTrackStructure - Likert and ungraded', () => {
  it('accepts a Likert question in a quiz', () => {
    expect(() =>
      validateTrackStructure(sectionWith(quizWith([likert]))),
    ).not.toThrow();
  });

  it('rejects a Likert with fewer than two scale points', () => {
    const q = { ...likert, scale: [{ id: 'p1', text: 'Only' }] };
    expect(() => validateTrackStructure(sectionWith(quizWith([q])))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a Likert with no statements', () => {
    const q = { ...likert, statements: [] };
    expect(() => validateTrackStructure(sectionWith(quizWith([q])))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a Likert marked as graded', () => {
    const q = { ...likert, isGraded: true };
    expect(() => validateTrackStructure(sectionWith(quizWith([q])))).toThrow(
      /no right answer/,
    );
  });

  it('accepts an ungraded MCQ with no correct option', () => {
    const q = { ...mcq, isGraded: false, correctOptionIds: [] };
    expect(() =>
      validateTrackStructure(sectionWith(quizWith([q]))),
    ).not.toThrow();
  });

  it('still rejects a graded MCQ with no correct option', () => {
    const q = { ...mcq, correctOptionIds: [] };
    expect(() => validateTrackStructure(sectionWith(quizWith([q])))).toThrow(
      /correct option/,
    );
  });

  it('still checks a key an ungraded question does give', () => {
    const q = { ...mcq, isGraded: false, correctOptionIds: ['zzz'] };
    expect(() => validateTrackStructure(sectionWith(quizWith([q])))).toThrow(
      /does not match/,
    );
  });

  it('accepts an ungraded open-ended question with no rubric', () => {
    const q = {
      id: 'oe',
      type: QuizQuestionType.OPEN_ENDED,
      prompt: 'Reflect on today',
      isGraded: false,
    };
    expect(() =>
      validateTrackStructure(sectionWith(quizWith([q]))),
    ).not.toThrow();
  });

  it('rejects a non-boolean showCorrectAnswer', () => {
    const q = { ...mcq, showCorrectAnswer: 'no' };
    expect(() => validateTrackStructure(sectionWith(quizWith([q])))).toThrow(
      /showCorrectAnswer/,
    );
  });

  it('rejects an ungraded video interjection', () => {
    const video = {
      type: TrackItemType.VIDEO,
      order: 1,
      title: 'Video',
      content: {
        source: 's3',
        url: 'https://example.com/v.mp4',
        durationSeconds: 60,
        interjections: [
          {
            id: 'int',
            timestampSeconds: 5,
            question: { ...mcq, isGraded: false },
          },
        ],
      },
    };
    expect(() => validateTrackStructure(sectionWith(video))).toThrow(
      /only be ungraded inside a quiz/,
    );
  });

  it('rejects a Likert video interjection', () => {
    const video = {
      type: TrackItemType.VIDEO,
      order: 1,
      title: 'Video',
      content: {
        source: 's3',
        url: 'https://example.com/v.mp4',
        durationSeconds: 60,
        interjections: [{ id: 'int', timestampSeconds: 5, question: likert }],
      },
    };
    expect(() => validateTrackStructure(sectionWith(video))).toThrow(
      /only supported in a quiz/,
    );
  });
});

describe('computeStructuralSignature - Likert and ungraded', () => {
  const sig = (questions: any[]) =>
    computeStructuralSignature(sectionWith(quizWith(questions)));

  it('is unchanged for questions that set neither new field', () => {
    // Explicit defaults must read the same as absent ones, or every course
    // with enrollments would lock the moment the builder starts writing them.
    expect(sig([{ ...mcq, isGraded: true, showCorrectAnswer: true }])).toEqual(
      sig([mcq]),
    );
  });

  it('changes when a question is made ungraded', () => {
    expect(sig([{ ...mcq, isGraded: false }])).not.toEqual(sig([mcq]));
  });

  it('does not change when the answer is hidden', () => {
    expect(sig([{ ...mcq, showCorrectAnswer: false }])).toEqual(sig([mcq]));
  });

  it('changes when a Likert statement is removed', () => {
    const fewer = { ...likert, statements: likert.statements.slice(0, 1) };
    expect(sig([fewer])).not.toEqual(sig([likert]));
  });

  it('does not change when Likert wording is edited', () => {
    const reworded = {
      ...likert,
      scale: likert.scale.map((p) => ({ ...p, text: p.text.toUpperCase() })),
    };
    expect(sig([reworded])).toEqual(sig([likert]));
  });
});
