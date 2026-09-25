import {
  QuestionMedia,
  QuizContent,
  QuizQuestion,
  QuizQuestionType,
} from '../type/quiz.type';
import { isQuestionGraded } from '../util/track-quiz-grading.util';

export interface LearnerQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  /** 0 for an ungraded question. */
  points: number;
  /** false = answered but not scored; the player labels it so. */
  graded: boolean;
  /** Part of the stem, so it crosses to the learner alongside the prompt. */
  media?: QuestionMedia;
  options?: { id: string; text: string }[];
  items?: { id: string; text: string }[];
  left?: { id: string; text: string }[];
  right?: { id: string; text: string }[];
  template?: string;
  blankIds?: string[];
  minWords?: number;
  /** likert_scale — rows to rate, and the scale points lowest first. */
  statements?: { id: string; text: string }[];
  scale?: { id: string; text: string }[];
}

export interface LearnerQuiz {
  settings: {
    passScore: number;
    maxAttempts: number | null;
    showExplanations: string;
  };
  questions: LearnerQuizQuestion[];
  /** Graded questions only; 0 means a survey with no score to pass. */
  totalPoints: number;
}

/** Deterministic Fisher-Yates so retries within an attempt see stable order. */
function seededShuffle<T>(input: T[], seedText: string): T[] {
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) {
    seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
  }
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const result = input.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function questionPoints(question: QuizQuestion): number {
  return question.points && question.points > 0 ? question.points : 1;
}

/**
 * Strip everything a learner must not see (correct answers, accepted answers,
 * rubric, explanations) from a single question. Shared by `sanitizeQuizForLearner`
 * (a whole quiz attempt, one question at a time) and by standalone questions —
 * e.g. a video interjection — that have no quiz-level settings of their own.
 *
 * `seedText` scopes the ORDERING/MATCHING "always shuffled" shuffle (and
 * MCQ option shuffle when `shuffleOptions` is set) so the order is stable
 * across reloads; callers with no natural attempt to scope to (a standalone
 * interjection question is answered once, not attempted) can omit it and get
 * a shuffle stable per question id instead. `shuffleOptions` defaults to
 * `false` — there is no quiz-level setting to inherit outside a quiz.
 */
export function sanitizeQuizQuestionForLearner(
  question: QuizQuestion,
  options?: { seedText?: string; shuffleOptions?: boolean },
): LearnerQuizQuestion {
  const seedText = options?.seedText ?? question.id;
  const shuffleOptions = options?.shuffleOptions ?? false;
  const base: LearnerQuizQuestion = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    points: isQuestionGraded(question) ? questionPoints(question) : 0,
    graded: isQuestionGraded(question),
    // This function is an allowlist, not a redaction pass: anything not
    // named here never reaches the learner. Media is part of the question
    // being asked, so it is named.
    ...(question.media ? { media: question.media } : {}),
  };
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI: {
      base.options = shuffleOptions
        ? seededShuffle(question.options, `o:${seedText}:${question.id}`)
        : question.options;
      return base;
    }
    case QuizQuestionType.TRUE_FALSE:
      return base;
    case QuizQuestionType.ORDERING: {
      // Always shuffled — presenting the authored (correct) order would
      // give the answer away.
      base.items = seededShuffle(
        question.items,
        `i:${seedText}:${question.id}`,
      );
      return base;
    }
    case QuizQuestionType.MATCHING: {
      base.left = question.left;
      base.right = seededShuffle(
        question.right,
        `r:${seedText}:${question.id}`,
      );
      return base;
    }
    case QuizQuestionType.FILL_BLANK: {
      base.template = question.template;
      base.blankIds = question.blanks.map((blank) => blank.id);
      return base;
    }
    case QuizQuestionType.OPEN_ENDED: {
      base.minWords = question.minWords;
      return base;
    }
    case QuizQuestionType.LIKERT_SCALE: {
      // Never shuffled: the statements may build on one another, and a scale
      // is only readable in order.
      base.statements = question.statements;
      base.scale = question.scale;
      return base;
    }
    default:
      return base;
  }
}

/**
 * Strip everything a learner must not see (correct answers, accepted answers,
 * rubric, explanations) and apply the configured shuffles. `seedText` scopes
 * shuffling to an attempt so the order is stable across reloads mid-attempt.
 */
export function sanitizeQuizForLearner(
  quiz: QuizContent,
  seedText: string,
): LearnerQuiz {
  const settings = quiz.settings;
  let questions = quiz.questions.slice();
  if (settings.shuffleQuestions) {
    questions = seededShuffle(questions, `q:${seedText}`);
  }

  const sanitized: LearnerQuizQuestion[] = questions.map((question) =>
    sanitizeQuizQuestionForLearner(question, {
      shuffleOptions: settings.shuffleOptions,
      seedText,
    }),
  );

  return {
    settings: {
      passScore: settings.passScore,
      maxAttempts: settings.maxAttempts ?? null,
      showExplanations: settings.showExplanations ?? 'after_submit',
    },
    questions: sanitized,
    totalPoints: quiz.questions
      .filter(isQuestionGraded)
      .reduce((sum, question) => sum + questionPoints(question), 0),
  };
}
