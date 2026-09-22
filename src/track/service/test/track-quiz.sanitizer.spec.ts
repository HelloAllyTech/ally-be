import {
  sanitizeQuizForLearner,
  sanitizeQuizQuestionForLearner,
} from '../track-quiz.sanitizer';
import {
  QuestionMedia,
  QuestionMediaKind,
  QuestionMediaSource,
  QuizContent,
  QuizQuestion,
  QuizQuestionType,
} from '../../type/quiz.type';

const media: QuestionMedia = {
  kind: QuestionMediaKind.IMAGE,
  source: QuestionMediaSource.S3,
  url: 'https://bucket.s3.ap-south-1.amazonaws.com/track-media/question_image/1-wound.png',
  alt: 'A dressed wound on a forearm',
};

function mcq(overrides: Partial<QuizQuestion> = {}): QuizQuestion {
  return {
    id: 'q1',
    type: QuizQuestionType.MCQ_SINGLE,
    prompt: 'What do you see?',
    explanation: 'Because the dressing is clean.',
    points: 2,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    correctOptionIds: ['a'],
    ...overrides,
  } as QuizQuestion;
}

describe('sanitizeQuizQuestionForLearner - media', () => {
  it('carries media through to the learner', () => {
    const result = sanitizeQuizQuestionForLearner(mcq({ media }));
    expect(result.media).toEqual(media);
  });

  it('omits the key entirely when the question has no media', () => {
    const result = sanitizeQuizQuestionForLearner(mcq());
    expect(result).not.toHaveProperty('media');
  });

  it('still withholds the answer key alongside the media', () => {
    const result = sanitizeQuizQuestionForLearner(
      mcq({ media }),
    ) as unknown as Record<string, unknown>;
    expect(result.media).toEqual(media);
    expect(result.correctOptionIds).toBeUndefined();
    expect(result.explanation).toBeUndefined();
  });

  it('carries media on every question type, not just MCQ', () => {
    const openEnded = sanitizeQuizQuestionForLearner({
      id: 'q2',
      type: QuizQuestionType.OPEN_ENDED,
      prompt: 'Describe what you observe.',
      media,
      rubric: { guidance: 'secret', maxScore: 5 },
    } as QuizQuestion);
    expect(openEnded.media).toEqual(media);
    expect(
      (openEnded as unknown as Record<string, unknown>).rubric,
    ).toBeUndefined();
  });
});

describe('sanitizeQuizForLearner - media', () => {
  it('carries media through a whole-quiz sanitize, shuffled or not', () => {
    const quiz: QuizContent = {
      settings: { passScore: 70, shuffleQuestions: true },
      questions: [mcq({ media }), mcq({ id: 'q2' })],
    };
    const result = sanitizeQuizForLearner(quiz, 'attempt-1');
    const withMedia = result.questions.find((q) => q.id === 'q1');
    const without = result.questions.find((q) => q.id === 'q2');
    expect(withMedia?.media).toEqual(media);
    expect(without).not.toHaveProperty('media');
  });
});
