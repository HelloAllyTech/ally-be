export enum QuizQuestionType {
  MCQ_SINGLE = 'mcq_single',
  MCQ_MULTI = 'mcq_multi',
  TRUE_FALSE = 'true_false',
  ORDERING = 'ordering',
  MATCHING = 'matching',
  FILL_BLANK = 'fill_blank',
  OPEN_ENDED = 'open_ended',
}

export enum QuizShowExplanations {
  AFTER_EACH = 'after_each',
  AFTER_SUBMIT = 'after_submit',
  NEVER = 'never',
}

export enum QuizAttemptStatus {
  SUBMITTED = 'SUBMITTED',
  PENDING_GRADING = 'PENDING_GRADING',
  GRADED = 'GRADED',
}

export interface QuizSettings {
  /** Percent (0-100) required to pass; mirrored into completionCriteria.passScore. */
  passScore: number;
  /** null / undefined = unlimited attempts. */
  maxAttempts?: number | null;
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  showExplanations?: QuizShowExplanations;
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestionBase {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  explanation?: string;
  points?: number;
}

export interface McqSingleQuestion extends QuizQuestionBase {
  type: QuizQuestionType.MCQ_SINGLE;
  options: QuizOption[];
  correctOptionIds: [string];
}

export interface McqMultiQuestion extends QuizQuestionBase {
  type: QuizQuestionType.MCQ_MULTI;
  options: QuizOption[];
  correctOptionIds: string[];
  /** false / undefined = all-or-nothing. */
  partialCredit?: boolean;
}

export interface TrueFalseQuestion extends QuizQuestionBase {
  type: QuizQuestionType.TRUE_FALSE;
  correctAnswer: boolean;
}

export interface OrderingQuestion extends QuizQuestionBase {
  type: QuizQuestionType.ORDERING;
  items: QuizOption[];
  correctOrder: string[];
}

export interface MatchingQuestion extends QuizQuestionBase {
  type: QuizQuestionType.MATCHING;
  left: QuizOption[];
  /** May contain distractors that pair with nothing. */
  right: QuizOption[];
  correctPairs: { leftId: string; rightId: string }[];
}

export interface FillBlankQuestion extends QuizQuestionBase {
  type: QuizQuestionType.FILL_BLANK;
  /** Prompt text with `{{blankId}}` tokens marking each blank. */
  template: string;
  blanks: {
    id: string;
    acceptedAnswers: string[];
    caseSensitive?: boolean;
  }[];
}

export interface OpenEndedRubric {
  guidance: string;
  criteria?: { name: string; description?: string; weight?: number }[];
  maxScore: number;
}

export interface OpenEndedQuestion extends QuizQuestionBase {
  type: QuizQuestionType.OPEN_ENDED;
  minWords?: number;
  rubric: OpenEndedRubric;
}

export type QuizQuestion =
  | McqSingleQuestion
  | McqMultiQuestion
  | TrueFalseQuestion
  | OrderingQuestion
  | MatchingQuestion
  | FillBlankQuestion
  | OpenEndedQuestion;

export interface QuizContent {
  settings: QuizSettings;
  questions: QuizQuestion[];
}

export interface QuizAnswer {
  questionId: string;
  selectedOptionIds?: string[];
  booleanAnswer?: boolean;
  orderedItemIds?: string[];
  pairs?: { leftId: string; rightId: string }[];
  blanks?: { blankId: string; answer: string }[];
  text?: string;
}

export interface QuizQuestionGrading {
  questionId: string;
  /** null while an open-ended question is pending LLM grading. */
  correct: boolean | null;
  pointsAwarded: number;
  pointsPossible: number;
  llm?: {
    score: number;
    feedback: string;
    criteriaScores?: { name: string; score: number }[];
  };
}
