export enum QuizQuestionType {
  MCQ_SINGLE = 'mcq_single',
  MCQ_MULTI = 'mcq_multi',
  TRUE_FALSE = 'true_false',
  ORDERING = 'ordering',
  MATCHING = 'matching',
  FILL_BLANK = 'fill_blank',
  OPEN_ENDED = 'open_ended',
  LIKERT_SCALE = 'likert_scale',
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

/**
 * What a question's media attachment *is*, which is also what the learner's
 * client has to render: a still image or a moving one. Kept separate from
 * {@link QuestionMediaSource} (where the bytes live) because the two vary
 * independently — a video may be uploaded or embedded, and both render in a
 * player.
 */
export enum QuestionMediaKind {
  IMAGE = 'image',
  VIDEO = 'video',
}

/**
 * Where the media lives. `s3` is a file the trainer uploaded through the
 * track-media presign endpoint; the rest are third-party embeds and mirror
 * `VideoSource` on the VIDEO component, deliberately — a trainer who has
 * already learned "paste a YouTube/Vimeo/Loom link" for a video lesson
 * should not meet a different list here.
 */
export enum QuestionMediaSource {
  S3 = 's3',
  YOUTUBE = 'youtube',
  VIMEO = 'vimeo',
  LOOM = 'loom',
}

/**
 * A picture or clip shown with a question, so the question can ask what the
 * learner *observes* rather than only what they can read. Part of the
 * question stem, not decoration: it renders above the answer controls, and
 * it survives into the results screen so a learner reviewing a wrong answer
 * still sees what they were looking at.
 *
 * Lives on {@link QuizQuestionBase}, so a video interjection and an inline
 * article question carry it on the same terms as a quiz question — one
 * validator, one sanitizer, one renderer per client.
 */
export interface QuestionMedia {
  kind: QuestionMediaKind;
  source: QuestionMediaSource;
  /** Public S3 URL, or the third-party watch URL the trainer pasted. */
  url: string;
  /**
   * What the media shows, for screen readers and for the learner whose
   * connection drops the file. Images only: a video that fails to load
   * renders its own player-level error, and alt text on a `<video>` has no
   * defined behaviour.
   */
  alt?: string;
  /**
   * Still frame for an uploaded video, captured in the browser at author
   * time and stored beside it.
   *
   * Uploaded video only — a third-party embed brings its own thumbnail.
   * Without this, what the learner sees before pressing play is whatever
   * the player happens to paint: a browser with `preload="metadata"` shows
   * the first frame, but Android's ExoPlayer is not guaranteed to render
   * anything before playback starts. A black rectangle is the wrong thing
   * to show someone who is being asked what they observe, so the frame is
   * captured once rather than left to each player.
   */
  posterUrl?: string;
}

export interface QuizQuestionBase {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  explanation?: string;
  points?: number;
  /** Optional picture or clip shown with the prompt. */
  media?: QuestionMedia;
  /**
   * `false` = the question earns no points and is left out of the quiz score,
   * so a quiz can mix assessment with survey or reflection prompts. Absent =
   * graded, which is every question written before this field existed.
   *
   * An ungraded question may omit its answer key; when it keeps one, the
   * learner still sees whether they got it right — it is practice, it just
   * doesn't count. `LIKERT_SCALE` is never graded whatever this says. Quiz
   * items only: article and video questions are always graded.
   */
  isGraded?: boolean;
  /**
   * `false` = after submitting, the learner is told whether they were right
   * but not what the right answer was. Absent = shown. Independent of
   * `isGraded`, and meaningless for a question with no answer key. Quiz
   * items only.
   */
  showCorrectAnswer?: boolean;
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

/**
 * One rating scale applied to several statements — "rate each of these from
 * Strongly disagree to Strongly agree". Opinion, not knowledge: there is no
 * answer key and it is never graded. The scale is shared by every statement,
 * which is what makes the answers comparable; a matrix of per-row scales is
 * deliberately out of scope.
 */
export interface LikertScaleQuestion extends QuizQuestionBase {
  type: QuizQuestionType.LIKERT_SCALE;
  /** The things being rated, one row each. */
  statements: QuizOption[];
  /** The scale points, lowest first — e.g. Strongly disagree … Strongly agree. */
  scale: QuizOption[];
}

export type QuizQuestion =
  | McqSingleQuestion
  | McqMultiQuestion
  | TrueFalseQuestion
  | OrderingQuestion
  | MatchingQuestion
  | FillBlankQuestion
  | OpenEndedQuestion
  | LikertScaleQuestion;

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
  /** likert_scale — one scale point per statement. */
  ratings?: { statementId: string; scaleOptionId: string }[];
}

export interface QuizQuestionGrading {
  questionId: string;
  /**
   * null while an open-ended question is pending LLM grading, and for an
   * ungraded question with no answer key to be right or wrong against. Check
   * `graded` before reading null as "pending".
   */
  correct: boolean | null;
  /**
   * false = counted for nothing (`pointsPossible` is 0). Absent on attempts
   * stored before ungraded questions existed, all of which were graded.
   */
  graded?: boolean;
  pointsAwarded: number;
  pointsPossible: number;
  llm?: {
    score: number;
    feedback: string;
    criteriaScores?: { name: string; score: number }[];
  };
}
