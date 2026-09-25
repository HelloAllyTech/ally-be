import {
  FillBlankQuestion,
  MatchingQuestion,
  McqMultiQuestion,
  McqSingleQuestion,
  OpenEndedQuestion,
  OrderingQuestion,
  QuizQuestion,
  QuizQuestionType,
  TrueFalseQuestion,
} from '../type/quiz.type';

/**
 * The answer key as the learner's results screen shows it. Same field names
 * as `QuizAnswer`, so a client can render "your answer" and "correct answer"
 * with one component; fill-blank carries every accepted answer, not one.
 */
export interface QuizCorrectAnswer {
  selectedOptionIds?: string[];
  booleanAnswer?: boolean;
  orderedItemIds?: string[];
  pairs?: { leftId: string; rightId: string }[];
  blanks?: { blankId: string; acceptedAnswers: string[] }[];
}

/**
 * Whether a question counts towards the quiz score. Likert is opinion and is
 * never graded; everything else is graded unless the trainer switched it off.
 */
export function isQuestionGraded(question: QuizQuestion): boolean {
  if (question.type === QuizQuestionType.LIKERT_SCALE) return false;
  return question.isGraded !== false;
}

/**
 * Whether the question carries enough of an answer key to mark a response
 * right or wrong. Only an ungraded question may lack one — validation
 * requires it on graded questions — so this is what separates "practice that
 * doesn't count" (verdict shown) from "a survey question" (no verdict).
 */
export function hasAnswerKey(question: QuizQuestion): boolean {
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI:
      return (
        ((question as McqSingleQuestion | McqMultiQuestion).correctOptionIds
          ?.length ?? 0) > 0
      );
    case QuizQuestionType.TRUE_FALSE:
      return typeof (question as TrueFalseQuestion).correctAnswer === 'boolean';
    case QuizQuestionType.ORDERING:
      return ((question as OrderingQuestion).correctOrder?.length ?? 0) > 0;
    case QuizQuestionType.MATCHING:
      return ((question as MatchingQuestion).correctPairs?.length ?? 0) > 0;
    case QuizQuestionType.FILL_BLANK: {
      const blanks = (question as FillBlankQuestion).blanks ?? [];
      return (
        blanks.length > 0 &&
        blanks.every((blank) => (blank.acceptedAnswers?.length ?? 0) > 0)
      );
    }
    case QuizQuestionType.OPEN_ENDED:
      // A rubric is a key only if the LLM is going to use it, which it does
      // for graded questions alone.
      return (
        isQuestionGraded(question) &&
        !!(question as OpenEndedQuestion).rubric?.guidance?.trim()
      );
    default:
      return false;
  }
}

/**
 * The key to reveal on the results screen, or null when there is nothing to
 * reveal — the trainer hid it, the question has no key, or its "answer" is an
 * AI judgement against a rubric rather than a fixed response (open-ended
 * questions get written feedback instead).
 */
export function correctAnswerOf(
  question: QuizQuestion,
): QuizCorrectAnswer | null {
  if (question.showCorrectAnswer === false) return null;
  if (!hasAnswerKey(question)) return null;
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI:
      return { selectedOptionIds: question.correctOptionIds.slice() };
    case QuizQuestionType.TRUE_FALSE:
      return { booleanAnswer: question.correctAnswer };
    case QuizQuestionType.ORDERING:
      return { orderedItemIds: question.correctOrder.slice() };
    case QuizQuestionType.MATCHING:
      return {
        pairs: question.correctPairs.map((pair) => ({
          leftId: pair.leftId,
          rightId: pair.rightId,
        })),
      };
    case QuizQuestionType.FILL_BLANK:
      return {
        blanks: question.blanks.map((blank) => ({
          blankId: blank.id,
          acceptedAnswers: blank.acceptedAnswers.slice(),
        })),
      };
    default:
      return null;
  }
}
