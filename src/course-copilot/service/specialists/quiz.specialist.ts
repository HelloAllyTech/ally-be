import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  TRACK_DEFAULT_QUIZ_PASS_SCORE,
  TRACK_LIKERT_MAX_SCALE_POINTS,
  TRACK_LIKERT_MAX_STATEMENTS,
  TRACK_LIKERT_MIN_SCALE_POINTS,
} from 'src/track/constants/track.constant';
import {
  FillBlankQuestion,
  LikertScaleQuestion,
  MatchingQuestion,
  McqMultiQuestion,
  McqSingleQuestion,
  OpenEndedQuestion,
  OrderingQuestion,
  QuizContent,
  QuizOption,
  QuizQuestion,
  QuizQuestionType,
  QuizShowExplanations,
  TrueFalseQuestion,
} from 'src/track/type/quiz.type';
import { TrackItemType } from 'src/track/type/track.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ItemSpecialist,
  SpecialistContext,
  SpecialistOutput,
} from './specialist.types';
import {
  asArray,
  asBoolean,
  asNumber,
  asText,
  assertNoProblems,
  assertTrackItemContent,
  briefForPrompt,
  clampInt,
  collectContentIds,
  courseOutlineForPrompt,
  foldText,
  IdMinter,
  isRecord,
  itemForPrompt,
  objectivesForPrompt,
  plural,
  resolveCorrectOptions,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

const DEFAULT_QUIZ_QUESTIONS = 6;
const DEFAULT_OPEN_ENDED_MAX_SCORE = 10;
const OPEN_ENDED_MIN_CRITERIA = 2;
const OPEN_ENDED_MAX_CRITERIA = 4;

/**
 * Types whose wrong options are written to be tempting — each must explain
 * why the right answer is right. Stacks: "Forced-Choice Questions Provide Cues
 * and Reveal Misconceptions".
 */
const FORCED_CHOICE: ReadonlySet<QuizQuestionType> = new Set([
  QuizQuestionType.MCQ_SINGLE,
  QuizQuestionType.MCQ_MULTI,
  QuizQuestionType.TRUE_FALSE,
  QuizQuestionType.ORDERING,
  QuizQuestionType.MATCHING,
]);

const TYPE_ALIASES: Record<string, QuizQuestionType> = {
  mcq: QuizQuestionType.MCQ_SINGLE,
  multiple_choice: QuizQuestionType.MCQ_SINGLE,
  single_choice: QuizQuestionType.MCQ_SINGLE,
  multiple_select: QuizQuestionType.MCQ_MULTI,
  multi_select: QuizQuestionType.MCQ_MULTI,
  select_all: QuizQuestionType.MCQ_MULTI,
  truefalse: QuizQuestionType.TRUE_FALSE,
  true_or_false: QuizQuestionType.TRUE_FALSE,
  boolean: QuizQuestionType.TRUE_FALSE,
  order: QuizQuestionType.ORDERING,
  sequence: QuizQuestionType.ORDERING,
  match: QuizQuestionType.MATCHING,
  fill_in_the_blank: QuizQuestionType.FILL_BLANK,
  fill_in_blank: QuizQuestionType.FILL_BLANK,
  cloze: QuizQuestionType.FILL_BLANK,
  open: QuizQuestionType.OPEN_ENDED,
  short_answer: QuizQuestionType.OPEN_ENDED,
  written: QuizQuestionType.OPEN_ENDED,
  essay: QuizQuestionType.OPEN_ENDED,
  likert: QuizQuestionType.LIKERT_SCALE,
  rating: QuizQuestionType.LIKERT_SCALE,
  self_rating: QuizQuestionType.LIKERT_SCALE,
};

const DEFAULT_CONFIDENCE_SCALE = [
  'Not at all confident',
  'Slightly confident',
  'Somewhat confident',
  'Confident',
  'Very confident',
];

/** How a summary names each type: "7 questions (5 multiple choice, 2 written)". */
const SUMMARY_GROUPS: { label: string; types: QuizQuestionType[] }[] = [
  {
    label: 'multiple choice',
    types: [QuizQuestionType.MCQ_SINGLE, QuizQuestionType.MCQ_MULTI],
  },
  { label: 'true/false', types: [QuizQuestionType.TRUE_FALSE] },
  { label: 'matching', types: [QuizQuestionType.MATCHING] },
  { label: 'ordering', types: [QuizQuestionType.ORDERING] },
  { label: 'fill in the blank', types: [QuizQuestionType.FILL_BLANK] },
  { label: 'written', types: [QuizQuestionType.OPEN_ENDED] },
  { label: 'self-rating', types: [QuizQuestionType.LIKERT_SCALE] },
];

interface QuizNormaliseOptions {
  title: string;
  passScore: number;
  includeSelfRating: boolean;
  keepIds: ReadonlySet<string>;
  lenient: boolean;
}

/**
 * Writes one QUIZ item.
 *
 * Stacks: "Forced-Choice Questions Provide Cues and Reveal Misconceptions" —
 * the default mix is mostly forced-choice with distractors drawn from this
 * audience's real misconceptions, every forced-choice question explained, plus
 * one or two open-ended scenario questions when the outcome is about doing.
 * "Developing Rating Scales for Assessment Scoring" — an open-ended rubric's
 * criteria are single observable behaviours listed in the order they occur in
 * a good answer. "Iterative Development of Scoring Guides for Open-Ended
 * Assessments" — with no learner answers yet to calibrate against, the
 * guidance describes the anticipated range (strong / partial / weak) so the
 * grader has more than an ideal answer to compare to.
 *
 * Every non-Likert question is graded and keyed: an ungraded question is a
 * survey prompt, which a reflection JOURNAL does better. Likert only with
 * `spec.includeSelfRating`.
 *
 * Strict on the first attempt (any broken question → repair pass with the
 * reasons); lenient on the repair pass, where a still-broken question is
 * dropped as long as one valid question remains.
 */
@Injectable()
export class QuizSpecialist implements ItemSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(context: SpecialistContext): Promise<SpecialistOutput> {
    const { brief, blueprint, item, previous } = context;
    const spec = item.spec ?? {};
    const questionCount = clampInt(
      spec.questionCount,
      1,
      COURSE_COPILOT_LIMITS.quizQuestions,
      DEFAULT_QUIZ_QUESTIONS,
    );
    const includeSelfRating = spec.includeSelfRating === true;
    const questionTypes = asArray(spec.questionTypes)
      .map((type) => toQuestionType(type))
      .filter((type): type is QuizQuestionType => !!type);

    const { data } = await this.llm.runJson({
      specialist: 'quiz',
      promptCode: COURSE_COPILOT_PROMPTS.QUIZ_WRITER,
      taskId: COURSE_COPILOT_AI_TASKS.QUIZ,
      task: LlmTask.COURSE_COPILOT_QUIZ,
      maxTokens: SPECIALIST_MAX_TOKENS.QUIZ,
      usageMetadata: context.usageMetadata,
      repairErrors: context.repairErrors,
      previous,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint, item.id),
        item_json: itemForPrompt(item),
        objectives: objectivesForPrompt(brief, item),
        question_count: String(questionCount),
        difficulty: asText(spec.difficulty) || 'matched to the audience',
        type_instruction: questionTypes.length
          ? `The trainer chose these question types: ${Array.from(
              new Set(questionTypes),
            ).join(', ')}. Use only these.`
          : 'Use the default mix below.',
        likert_instruction: includeSelfRating
          ? 'Finish with ONE likert_scale self-rating question: 3-6 "I can …" statements drawn from this quiz\'s outcomes, on a 5-point scale from "Not at all confident" to "Very confident". It is never graded and counts towards nothing.'
          : 'Do not write likert_scale questions.',
        // Passed as a value because `renderTemplate` would blank a literal
        // double-brace token written into the prompt file itself.
        blank_token_example: '{{b1}}',
      },
    });

    return normaliseQuizOutput(data, {
      title: item.title,
      passScore: clampInt(
        item.completionCriteria?.passScore,
        0,
        100,
        TRACK_DEFAULT_QUIZ_PASS_SCORE,
      ),
      includeSelfRating,
      keepIds: previous ? collectContentIds(previous.content) : new Set(),
      lenient: Boolean(context.repairErrors?.length),
    });
  }
}

/** Pure: raw model JSON → validated QUIZ content. Exported for tests. */
export function normaliseQuizOutput(
  raw: Record<string, any>,
  opts: QuizNormaliseOptions,
): SpecialistOutput {
  const root = isRecord(raw.quiz) ? raw.quiz : raw;
  const ids = new IdMinter(opts.keepIds);
  const problems: string[] = [];
  const questions: QuizQuestion[] = [];

  asArray(root.questions)
    .filter(isRecord)
    .forEach((rawQuestion, index) => {
      if (questions.length >= COURSE_COPILOT_LIMITS.quizQuestions) return;
      const result = normaliseQuestion(rawQuestion, index, ids, opts);
      if (result === null) return;
      if (typeof result === 'string') {
        if (!opts.lenient) problems.push(result);
        return;
      }
      questions.push(result);
    });

  if (questions.length === 0 && problems.length === 0) {
    problems.push('The quiz has no usable questions.');
  }
  assertNoProblems(problems);

  const content: QuizContent = {
    settings: {
      passScore: opts.passScore,
      maxAttempts: null,
      shuffleQuestions: true,
      shuffleOptions: true,
      showExplanations: QuizShowExplanations.AFTER_SUBMIT,
    },
    questions,
  };
  assertTrackItemContent(TrackItemType.QUIZ, content, opts.title);

  return {
    content: content as unknown as Record<string, any>,
    summary: summariseQuiz(questions),
  };
}

export function summariseQuiz(questions: QuizQuestion[]): string {
  const parts = SUMMARY_GROUPS.map(({ label, types }) => ({
    label,
    count: questions.filter((question) => types.includes(question.type)).length,
  })).filter((part) => part.count > 0);
  const total = plural(questions.length, 'question');
  if (parts.length === 1) return `${total} (all ${parts[0].label})`;
  return `${total} (${parts.map((part) => `${part.count} ${part.label}`).join(', ')})`;
}

function toQuestionType(raw: unknown): QuizQuestionType | null {
  const key = asText(raw)
    .toLowerCase()
    .replace(/[\s/-]+/g, '_');
  if ((Object.values(QuizQuestionType) as string[]).includes(key)) {
    return key as QuizQuestionType;
  }
  return TYPE_ALIASES[key] ?? null;
}

/** A question, a reason it cannot be one, or null to drop it silently. */
function normaliseQuestion(
  raw: Record<string, any>,
  index: number,
  ids: IdMinter,
  opts: QuizNormaliseOptions,
): QuizQuestion | string | null {
  const type = toQuestionType(raw.type);
  const label = `Question ${index + 1}`;
  if (!type) return `${label} has an unknown type "${asText(raw.type)}".`;
  if (type === QuizQuestionType.LIKERT_SCALE && !opts.includeSelfRating) {
    return null;
  }

  const prompt = asText(raw.prompt ?? raw.question ?? raw.statement);
  if (
    !prompt &&
    type !== QuizQuestionType.FILL_BLANK &&
    type !== QuizQuestionType.LIKERT_SCALE
  ) {
    return `${label} has no prompt.`;
  }
  const explanation = asText(raw.explanation);
  if (FORCED_CHOICE.has(type) && !explanation && !opts.lenient) {
    return `${label} ("${prompt.slice(0, 60)}") needs an explanation of why the right answer is right.`;
  }

  const base: Record<string, any> = { id: ids.mint(raw.id), type, prompt };
  if (explanation) base.explanation = explanation;
  const points = asNumber(raw.points);
  if (points !== undefined && points > 0) base.points = Math.min(100, points);

  switch (type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI:
      return normaliseChoice(raw, base, type, ids, label);
    case QuizQuestionType.TRUE_FALSE: {
      const answer = asBoolean(raw.correctAnswer ?? raw.answer ?? raw.correct);
      if (answer === undefined) {
        return `${label} is true/false but has no correctAnswer (true or false).`;
      }
      return { ...base, correctAnswer: answer } as TrueFalseQuestion;
    }
    case QuizQuestionType.ORDERING:
      return normaliseOrdering(raw, base, ids, label);
    case QuizQuestionType.MATCHING:
      return normaliseMatching(raw, base, ids, label);
    case QuizQuestionType.FILL_BLANK:
      return normaliseFillBlank(raw, base, ids, label);
    case QuizQuestionType.OPEN_ENDED:
      return normaliseOpenEnded(raw, base, label);
    case QuizQuestionType.LIKERT_SCALE:
      return normaliseLikert(raw, base, ids, label);
    default:
      return `${label} has an unsupported type.`;
  }
}

/** Options with fresh ids, plus a map from the model's ids to them. */
function mintOptions(
  rawOptions: unknown,
  ids: IdMinter,
): { options: QuizOption[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const options: QuizOption[] = [];
  for (const rawOption of asArray(rawOptions)) {
    const option = isRecord(rawOption) ? rawOption : { text: rawOption };
    const text = asText(option.text ?? option.label ?? option.value);
    if (!text) continue;
    const id = ids.mint(option.id);
    const rawId = asText(option.id);
    if (rawId && !idMap.has(rawId)) idMap.set(rawId, id);
    options.push({ id, text });
  }
  return { options, idMap };
}

/** Look an option up by the model's id, then its text. */
function findOption(
  key: unknown,
  options: QuizOption[],
  idMap: Map<string, string>,
): string | undefined {
  const value = asText(key);
  if (!value) return undefined;
  if (idMap.has(value)) return idMap.get(value);
  const folded = foldText(value);
  return options.find((option) => foldText(option.text) === folded)?.id;
}

function normaliseChoice(
  raw: Record<string, any>,
  base: Record<string, any>,
  type: QuizQuestionType.MCQ_SINGLE | QuizQuestionType.MCQ_MULTI,
  ids: IdMinter,
  label: string,
): QuizQuestion | string {
  const { options, idMap } = mintOptions(raw.options ?? raw.choices, ids);
  if (options.length < 2) return `${label} needs at least two options.`;
  const correct = resolveCorrectOptions(raw, options, idMap);
  if (correct.length === 0) {
    return `${label} ("${String(base.prompt).slice(0, 60)}") has no correct option in correctOptionIds.`;
  }
  // A "single answer" question the model keyed with two right answers is a
  // select-all question; asking it as single-answer would mark a right answer wrong.
  if (type === QuizQuestionType.MCQ_SINGLE && correct.length === 1) {
    return {
      ...base,
      type,
      options,
      correctOptionIds: [correct[0]],
    } as McqSingleQuestion;
  }
  const question: McqMultiQuestion = {
    ...(base as any),
    type: QuizQuestionType.MCQ_MULTI,
    options,
    correctOptionIds: correct,
  };
  const partialCredit = asBoolean(raw.partialCredit);
  if (partialCredit !== undefined) question.partialCredit = partialCredit;
  return question;
}

/**
 * The prompt asks for items listed in the correct order; `correctOrder` is
 * taken when it is a valid permutation and derived from the listing when it
 * is absent. The player always shuffles ordering items, so the stored order
 * never leaks the answer.
 */
function normaliseOrdering(
  raw: Record<string, any>,
  base: Record<string, any>,
  ids: IdMinter,
  label: string,
): QuizQuestion | string {
  const { options: items, idMap } = mintOptions(raw.items ?? raw.options, ids);
  if (items.length < 2) return `${label} needs at least two items to order.`;
  const given = asArray(raw.correctOrder);
  let correctOrder = items.map((item) => item.id);
  if (given.length) {
    const mapped = given.map((key) => findOption(key, items, idMap));
    const valid =
      mapped.length === items.length &&
      mapped.every(Boolean) &&
      new Set(mapped).size === items.length;
    if (!valid) {
      return `${label}: correctOrder must list every item id exactly once.`;
    }
    correctOrder = mapped as string[];
  }
  return { ...base, items, correctOrder } as OrderingQuestion;
}

function normaliseMatching(
  raw: Record<string, any>,
  base: Record<string, any>,
  ids: IdMinter,
  label: string,
): QuizQuestion | string {
  let rawLeft = raw.left;
  let rawRight = raw.right;
  let rawPairs = raw.correctPairs;
  // Some models answer with pairs only: [{ left: "…", right: "…" }].
  if (!Array.isArray(rawLeft) && Array.isArray(raw.pairs)) {
    const pairs = raw.pairs.filter(isRecord);
    rawLeft = pairs.map((pair) => pair.left);
    rawRight = pairs.map((pair) => pair.right);
    rawPairs = pairs.map((pair) => ({
      leftId: pair.left,
      rightId: pair.right,
    }));
  }
  const left = mintOptions(rawLeft, ids);
  const right = mintOptions(rawRight, ids);
  if (!left.options.length || !right.options.length) {
    return `${label} needs items on both sides to match.`;
  }

  const correctPairs: { leftId: string; rightId: string }[] = [];
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();
  for (const pair of asArray(rawPairs).filter(isRecord)) {
    const leftId = findOption(
      pair.leftId ?? pair.left,
      left.options,
      left.idMap,
    );
    const rightId = findOption(
      pair.rightId ?? pair.right,
      right.options,
      right.idMap,
    );
    if (!leftId || !rightId) continue;
    if (usedLeft.has(leftId) || usedRight.has(rightId)) continue;
    usedLeft.add(leftId);
    usedRight.add(rightId);
    correctPairs.push({ leftId, rightId });
  }
  if (!correctPairs.length) {
    return `${label}: correctPairs must pair left ids with right ids.`;
  }
  return {
    ...base,
    left: left.options,
    right: right.options,
    correctPairs,
  } as MatchingQuestion;
}

/**
 * Blank ids are re-minted, so every `{{blankId}}` token in the template is
 * rewritten with them. A template that marks blanks with underscores instead
 * gets tokens in order.
 */
function normaliseFillBlank(
  raw: Record<string, any>,
  base: Record<string, any>,
  ids: IdMinter,
  label: string,
): QuizQuestion | string {
  let template = asText(raw.template ?? raw.text ?? raw.prompt);
  if (!template) return `${label} has no template.`;

  const blanks: FillBlankQuestion['blanks'] = [];
  const missingToken: string[] = [];
  for (const rawBlank of asArray(raw.blanks).filter(isRecord)) {
    const acceptedAnswers = (
      Array.isArray(rawBlank.acceptedAnswers)
        ? rawBlank.acceptedAnswers
        : [rawBlank.acceptedAnswers ?? rawBlank.answer]
    )
      .map((answer: unknown) => asText(answer))
      .filter(Boolean);
    if (!acceptedAnswers.length) {
      return `${label}: every blank needs at least one accepted answer.`;
    }
    const id = ids.mint(rawBlank.id);
    const rawId = asText(rawBlank.id);
    const tokenSource = rawId
      ? `\\{\\{\\s*${escapeRegExp(rawId)}\\s*\\}\\}`
      : null;
    if (tokenSource && new RegExp(tokenSource).test(template)) {
      template = template.replace(new RegExp(tokenSource, 'g'), `{{${id}}}`);
    } else {
      missingToken.push(id);
    }
    const blank: FillBlankQuestion['blanks'][number] = { id, acceptedAnswers };
    if (asBoolean(rawBlank.caseSensitive) === true) blank.caseSensitive = true;
    blanks.push(blank);
  }
  if (!blanks.length) return `${label} needs at least one blank.`;

  for (const id of missingToken) {
    const underscores = /_{3,}|\[blank\]/i;
    if (!underscores.test(template)) {
      return `${label}: the template must mark each blank with its id in double curly braces.`;
    }
    template = template.replace(underscores, `{{${id}}}`);
  }
  const known = new Set(blanks.map((blank) => blank.id));
  const stray = Array.from(template.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)).find(
    (match) => !known.has(match[1]),
  );
  if (stray) {
    return `${label}: the template has a blank ("${stray[1]}") with no accepted answers.`;
  }

  return {
    ...base,
    prompt: base.prompt || 'Fill in the blank.',
    template,
    blanks,
  } as FillBlankQuestion;
}

function normaliseOpenEnded(
  raw: Record<string, any>,
  base: Record<string, any>,
  label: string,
): QuizQuestion | string {
  const rubric = isRecord(raw.rubric) ? raw.rubric : {};
  const guidance = asText(rubric.guidance ?? raw.guidance);
  if (!guidance) return `${label} is open-ended and needs rubric guidance.`;
  const criteria = asArray(rubric.criteria ?? raw.criteria)
    .map((criterion) => {
      const entry = isRecord(criterion) ? criterion : { name: criterion };
      const name = asText(entry.name ?? entry.criterion, 120);
      if (!name) return null;
      const out: { name: string; description?: string; weight?: number } = {
        name,
      };
      const description = asText(entry.description);
      if (description) out.description = description;
      const weight = asNumber(entry.weight);
      if (weight !== undefined && weight > 0) out.weight = weight;
      return out;
    })
    .filter((criterion): criterion is NonNullable<typeof criterion> =>
      Boolean(criterion),
    )
    .slice(0, OPEN_ENDED_MAX_CRITERIA);
  if (criteria.length < OPEN_ENDED_MIN_CRITERIA) {
    return `${label} is open-ended and needs ${OPEN_ENDED_MIN_CRITERIA}-${OPEN_ENDED_MAX_CRITERIA} rubric criteria.`;
  }
  const maxScore = asNumber(rubric.maxScore ?? raw.maxScore);
  const question: OpenEndedQuestion = {
    ...(base as any),
    rubric: {
      guidance,
      criteria,
      maxScore:
        maxScore !== undefined && maxScore > 0
          ? Math.min(100, maxScore)
          : DEFAULT_OPEN_ENDED_MAX_SCORE,
    },
  };
  const minWords = asNumber(raw.minWords);
  if (minWords !== undefined && minWords > 0) {
    question.minWords = Math.min(500, Math.round(minWords));
  }
  return question;
}

function normaliseLikert(
  raw: Record<string, any>,
  base: Record<string, any>,
  ids: IdMinter,
  label: string,
): QuizQuestion | string {
  const statements = mintOptions(raw.statements, ids).options.slice(
    0,
    TRACK_LIKERT_MAX_STATEMENTS,
  );
  if (!statements.length)
    return `${label} needs at least one statement to rate.`;
  let scale = mintOptions(raw.scale, ids).options.slice(
    0,
    TRACK_LIKERT_MAX_SCALE_POINTS,
  );
  if (scale.length < TRACK_LIKERT_MIN_SCALE_POINTS) {
    scale = DEFAULT_CONFIDENCE_SCALE.map((text) => ({ id: ids.mint(), text }));
  }
  return {
    ...base,
    prompt: base.prompt || 'How confident do you feel about each of these?',
    statements,
    scale,
    // A rating has no right answer; say so rather than leave it implied.
    isGraded: false,
  } as LikertScaleQuestion;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
