import {
  FillBlankQuestion,
  MatchingQuestion,
  McqMultiQuestion,
  McqSingleQuestion,
  OrderingQuestion,
  QuizAnswer,
  QuizQuestion,
  QuizQuestionGrading,
  QuizQuestionType,
  TrueFalseQuestion,
} from '../type/quiz.type';
import { questionPoints } from './track-quiz.sanitizer';

/**
 * Pure per-question autograders. Open-ended questions return `correct: null`
 * with 0 points — the LLM grader fills those in afterwards.
 */
export function autogradeQuestion(
  question: QuizQuestion,
  answer: QuizAnswer | undefined,
): QuizQuestionGrading {
  const pointsPossible = questionPoints(question);
  const base: QuizQuestionGrading = {
    questionId: question.id,
    correct: false,
    pointsAwarded: 0,
    pointsPossible,
  };
  if (!answer) return base;

  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
      return gradeMcqSingle(question, answer, base);
    case QuizQuestionType.MCQ_MULTI:
      return gradeMcqMulti(question, answer, base);
    case QuizQuestionType.TRUE_FALSE:
      return gradeTrueFalse(question, answer, base);
    case QuizQuestionType.ORDERING:
      return gradeOrdering(question, answer, base);
    case QuizQuestionType.MATCHING:
      return gradeMatching(question, answer, base);
    case QuizQuestionType.FILL_BLANK:
      return gradeFillBlank(question, answer, base);
    case QuizQuestionType.OPEN_ENDED:
      return { ...base, correct: null };
    default:
      return base;
  }
}

function gradeMcqSingle(
  question: McqSingleQuestion,
  answer: QuizAnswer,
  base: QuizQuestionGrading,
): QuizQuestionGrading {
  const selected = answer.selectedOptionIds ?? [];
  const correct =
    selected.length === 1 && selected[0] === question.correctOptionIds[0];
  return {
    ...base,
    correct,
    pointsAwarded: correct ? base.pointsPossible : 0,
  };
}

function gradeMcqMulti(
  question: McqMultiQuestion,
  answer: QuizAnswer,
  base: QuizQuestionGrading,
): QuizQuestionGrading {
  const selected = new Set(answer.selectedOptionIds ?? []);
  const correctSet = new Set(question.correctOptionIds);

  if (!question.partialCredit) {
    const exact =
      selected.size === correctSet.size &&
      [...correctSet].every((id) => selected.has(id));
    return {
      ...base,
      correct: exact,
      pointsAwarded: exact ? base.pointsPossible : 0,
    };
  }

  const correctChosen = [...selected].filter((id) => correctSet.has(id)).length;
  const wrongChosen = [...selected].filter((id) => !correctSet.has(id)).length;
  const fraction = Math.max(0, (correctChosen - wrongChosen) / correctSet.size);
  const pointsAwarded = round2(fraction * base.pointsPossible);
  return {
    ...base,
    correct: fraction === 1,
    pointsAwarded,
  };
}

function gradeTrueFalse(
  question: TrueFalseQuestion,
  answer: QuizAnswer,
  base: QuizQuestionGrading,
): QuizQuestionGrading {
  const correct =
    typeof answer.booleanAnswer === 'boolean' &&
    answer.booleanAnswer === question.correctAnswer;
  return {
    ...base,
    correct,
    pointsAwarded: correct ? base.pointsPossible : 0,
  };
}

function gradeOrdering(
  question: OrderingQuestion,
  answer: QuizAnswer,
  base: QuizQuestionGrading,
): QuizQuestionGrading {
  const submitted = answer.orderedItemIds ?? [];
  const correct =
    submitted.length === question.correctOrder.length &&
    submitted.every((id, index) => id === question.correctOrder[index]);
  return {
    ...base,
    correct,
    pointsAwarded: correct ? base.pointsPossible : 0,
  };
}

function gradeMatching(
  question: MatchingQuestion,
  answer: QuizAnswer,
  base: QuizQuestionGrading,
): QuizQuestionGrading {
  const submittedPairs = answer.pairs ?? [];
  const correctByLeft = new Map(
    question.correctPairs.map((pair) => [pair.leftId, pair.rightId]),
  );
  const seenLeft = new Set<string>();
  let matched = 0;
  for (const pair of submittedPairs) {
    if (seenLeft.has(pair.leftId)) continue; // ignore duplicate submissions
    seenLeft.add(pair.leftId);
    if (correctByLeft.get(pair.leftId) === pair.rightId) matched++;
  }
  const total = question.correctPairs.length;
  const fraction = total > 0 ? matched / total : 0;
  return {
    ...base,
    correct: fraction === 1,
    pointsAwarded: round2(fraction * base.pointsPossible),
  };
}

function gradeFillBlank(
  question: FillBlankQuestion,
  answer: QuizAnswer,
  base: QuizQuestionGrading,
): QuizQuestionGrading {
  const submittedByBlank = new Map(
    (answer.blanks ?? []).map((blank) => [blank.blankId, blank.answer]),
  );
  let correctBlanks = 0;
  for (const blank of question.blanks) {
    const submitted = (submittedByBlank.get(blank.id) ?? '').trim();
    if (!submitted) continue;
    const matches = blank.acceptedAnswers.some((accepted) =>
      blank.caseSensitive
        ? accepted.trim() === submitted
        : accepted.trim().toLowerCase() === submitted.toLowerCase(),
    );
    if (matches) correctBlanks++;
  }
  const total = question.blanks.length;
  const fraction = total > 0 ? correctBlanks / total : 0;
  return {
    ...base,
    correct: fraction === 1,
    pointsAwarded: round2(fraction * base.pointsPossible),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
