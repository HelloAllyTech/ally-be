import { QuizContent, QuizQuestion, QuizQuestionType } from '../type/quiz.type';

export interface LearnerQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  points: number;
  options?: { id: string; text: string }[];
  items?: { id: string; text: string }[];
  left?: { id: string; text: string }[];
  right?: { id: string; text: string }[];
  template?: string;
  blankIds?: string[];
  minWords?: number;
}

export interface LearnerQuiz {
  settings: {
    passScore: number;
    maxAttempts: number | null;
    showExplanations: string;
  };
  questions: LearnerQuizQuestion[];
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

  const sanitized: LearnerQuizQuestion[] = questions.map((question) => {
    const base: LearnerQuizQuestion = {
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      points: questionPoints(question),
    };
    switch (question.type) {
      case QuizQuestionType.MCQ_SINGLE:
      case QuizQuestionType.MCQ_MULTI: {
        base.options = settings.shuffleOptions
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
      default:
        return base;
    }
  });

  return {
    settings: {
      passScore: settings.passScore,
      maxAttempts: settings.maxAttempts ?? null,
      showExplanations: settings.showExplanations ?? 'after_submit',
    },
    questions: sanitized,
    totalPoints: quiz.questions.reduce(
      (sum, question) => sum + questionPoints(question),
      0,
    ),
  };
}
