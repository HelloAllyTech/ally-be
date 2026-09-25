import { BadRequestException } from '@nestjs/common';
import {
  ArticleContent,
  ArticleQuestion,
  JournalContent,
  parseArticleQuestionMarkers,
  TrackItemType,
  VideoContent,
  VideoInterjection,
  VideoSource,
} from '../type/track.type';
import {
  FillBlankQuestion,
  MatchingQuestion,
  McqMultiQuestion,
  McqSingleQuestion,
  OpenEndedQuestion,
  OrderingQuestion,
  QuestionMedia,
  QuestionMediaKind,
  QuestionMediaSource,
  QuizContent,
  QuizQuestion,
  QuizQuestionType,
  QuizShowExplanations,
  TrueFalseQuestion,
} from '../type/quiz.type';
import {
  AnnotationArtifactKind,
  AnnotationContent,
  AnnotationRevealKey,
  AnnotationSwatch,
  markKey,
} from '../type/annotation.type';
import { GameContent, TrackGameKey } from '../type/game.type';
import {
  TRACK_MAX_ANNOTATION_LABELS,
  TRACK_MAX_ANNOTATION_UNITS,
  TRACK_MAX_ARTICLE_QUESTIONS,
  TRACK_MAX_ITEMS_PER_SECTION,
  TRACK_MAX_QUESTION_MEDIA_ALT_LENGTH,
  TRACK_MAX_QUIZ_QUESTIONS,
  TRACK_MAX_SECTIONS,
} from '../constants/track.constant';
import {
  UpsertTrackItemDto,
  UpsertTrackSectionDto,
} from '../dto/upsert-track-structure.dto';

function fail(message: string): never {
  throw new BadRequestException(message);
}

function assertSequentialOrders(orders: number[], label: string): void {
  const seen = new Set<number>();
  for (const order of orders) {
    if (seen.has(order)) fail(`Duplicate ${label} order: ${order}`);
    seen.add(order);
  }
  for (let i = 1; i <= orders.length; i++) {
    if (!seen.has(i)) {
      fail(`${label} order must be sequential starting from 1. Missing: ${i}`);
    }
  }
}

/**
 * Structural validation of a whole track tree (shape + per-type content).
 * Reference existence (scenario/case ids, tenant scope) is checked separately
 * in the service — this validator is pure and unit-testable.
 */
export function validateTrackStructure(
  sections: UpsertTrackSectionDto[],
): void {
  if (sections.length > TRACK_MAX_SECTIONS) {
    fail(`A track can contain at most ${TRACK_MAX_SECTIONS} sections.`);
  }
  assertSequentialOrders(
    sections.map((s) => s.order),
    'section',
  );

  const seenItemIds = new Set<string>();
  const seenSectionIds = new Set<string>();
  for (const section of sections) {
    if (section.id) {
      if (seenSectionIds.has(section.id)) {
        fail(`Duplicate section id: ${section.id}`);
      }
      seenSectionIds.add(section.id);
    }
    if (section.items.length > TRACK_MAX_ITEMS_PER_SECTION) {
      fail(
        `A section can contain at most ${TRACK_MAX_ITEMS_PER_SECTION} components.`,
      );
    }
    assertSequentialOrders(
      section.items.map((i) => i.order),
      `component (section "${section.title}")`,
    );
    for (const item of section.items) {
      if (item.id) {
        if (seenItemIds.has(item.id)) fail(`Duplicate item id: ${item.id}`);
        seenItemIds.add(item.id);
      }
      validateTrackItem(item);
    }
  }
}

export function validateTrackItem(item: UpsertTrackItemDto): void {
  switch (item.type) {
    case TrackItemType.ROLEPLAY:
      if (!item.scenarioId) {
        fail(`Roleplay component "${item.title}" must reference a scenario.`);
      }
      return;
    case TrackItemType.CASE:
      if (!item.caseId) {
        fail(`Case component "${item.title}" must reference a case.`);
      }
      return;
    default:
      validateTrackItemContent({
        type: item.type,
        content: item.content,
        title: item.title,
      });
  }
}

/**
 * Per-type content validation, factored out of `validateTrackItem` so a caller
 * that only has `{ type, content }` — no full track item, no order, no
 * section — can still run the exact same checks. The Component Library
 * templates service is the first such caller: a template has content but no
 * position in a tree.
 *
 * Deliberately does not accept ROLEPLAY/CASE here — those validate a
 * reference id, not `content`, and are handled by `validateTrackItem` above
 * before falling through to this helper.
 */
export function validateTrackItemContent({
  type,
  content,
  title = 'Component',
}: {
  type: TrackItemType;
  content: unknown;
  title?: string;
}): void {
  switch (type) {
    case TrackItemType.QUIZ:
      validateQuizContent(content as QuizContent | undefined, title);
      return;
    case TrackItemType.ARTICLE:
      validateArticleContent(content as ArticleContent | undefined, title);
      return;
    case TrackItemType.VIDEO:
      validateVideoContent(content as VideoContent | undefined, title);
      return;
    case TrackItemType.JOURNAL:
      validateJournalContent(content as JournalContent | undefined, title);
      return;
    case TrackItemType.ANNOTATED_ARTIFACT:
      validateAnnotationContent(
        content as AnnotationContent | undefined,
        title,
      );
      return;
    case TrackItemType.GAME:
      validateGameContent(content as GameContent | undefined, title);
      return;
    default:
      fail(`Unknown component type: ${type}`);
  }
}

function validateArticleContent(
  content: ArticleContent | undefined,
  title: string,
): void {
  if (!content?.html || !content.html.trim()) {
    fail(`Article component "${title}" must have content.`);
  }
  validateArticleQuestions(content, title);
}

/**
 * Inline article questions. Each is a single-select MCQ — the learner answers
 * it in place, once, and is told immediately whether they were right, which
 * leaves no room for the question types that need an LLM grader or a
 * multi-step widget; those belong in a QUIZ component.
 *
 * The question list and the HTML have to agree in both directions. A question
 * with no marker would never render (the author would think they had added
 * it), and a marker with no question would render an empty hole — and, worse,
 * once learners have answered, a deleted question orphans their stored
 * `answeredArticleQuestions` entry, which is why the ids are part of the
 * structural signature too.
 */
function validateArticleQuestions(
  content: ArticleContent,
  title: string,
): void {
  const questions = content.questions;
  const markers = parseArticleQuestionMarkers(content.html);

  if (!questions || questions.length === 0) {
    if (markers.length > 0) {
      fail(
        `Article component "${title}": the article has a question placeholder but no question to put in it.`,
      );
    }
    return;
  }

  if (questions.length > TRACK_MAX_ARTICLE_QUESTIONS) {
    fail(
      `Article component "${title}": at most ${TRACK_MAX_ARTICLE_QUESTIONS} questions.`,
    );
  }

  const markerCounts = new Map<string, number>();
  for (const id of markers) {
    markerCounts.set(id, (markerCounts.get(id) ?? 0) + 1);
  }

  const seenIds = new Set<string>();
  questions.forEach((question: ArticleQuestion, index) => {
    const label = `Article component "${title}" question ${index + 1}`;
    if (!question?.id) fail(`${label}: missing id.`);
    if (seenIds.has(question.id)) {
      fail(`${label}: duplicate id ${question.id}.`);
    }
    seenIds.add(question.id);

    if (question.type !== QuizQuestionType.MCQ_SINGLE) {
      fail(
        `${label}: only single-answer multiple choice is supported inside an article.`,
      );
    }
    validateQuizQuestion(question, label);

    const placements = markerCounts.get(question.id) ?? 0;
    if (placements === 0) {
      fail(`${label}: is not placed anywhere in the article.`);
    }
    if (placements > 1) {
      fail(`${label}: is placed in the article more than once.`);
    }
  });

  for (const id of markerCounts.keys()) {
    if (!seenIds.has(id)) {
      fail(
        `Article component "${title}": the article has a placeholder for a question that no longer exists.`,
      );
    }
  }
}

function validateVideoContent(
  content: VideoContent | undefined,
  title: string,
): void {
  if (!content?.url || !content.url.trim()) {
    fail(`Video component "${title}" must have a video URL.`);
  }
  if (!Object.values(VideoSource).includes(content.source)) {
    fail(`Video component "${title}" has an invalid source.`);
  }
  validateInterjections(content, title);
}

/**
 * Interjections hard-pause playback, which we can only guarantee on our own
 * S3-hosted player — third-party embeds (YouTube/Vimeo/Loom) give us no
 * reliable control over the playhead. Each interjection's question is a full
 * quiz question, validated the same way a quiz component's questions are;
 * open-ended is excluded because grading it needs the LLM grader, which has
 * no place gating video playback.
 */
function validateInterjections(video: VideoContent, title: string): void {
  const interjections = video.interjections;
  if (!interjections || interjections.length === 0) return;

  if (video.source !== VideoSource.S3) {
    fail(
      `Video component "${title}": quiz interjections are only supported for uploaded (S3) video.`,
    );
  }

  const seenIds = new Set<string>();
  interjections.forEach((interjection, index) => {
    const label = `Video component "${title}" interjection ${index + 1}`;
    if (!interjection.id) fail(`${label}: missing id.`);
    if (seenIds.has(interjection.id)) {
      fail(`${label}: duplicate id ${interjection.id}.`);
    }
    seenIds.add(interjection.id);

    if (
      typeof interjection.timestampSeconds !== 'number' ||
      interjection.timestampSeconds < 0
    ) {
      fail(`${label}: timestampSeconds must be zero or greater.`);
    }
    if (
      video.durationSeconds !== undefined &&
      interjection.timestampSeconds > video.durationSeconds
    ) {
      fail(`${label}: timestampSeconds is beyond the video's duration.`);
    }

    if (interjection.question?.type === QuizQuestionType.OPEN_ENDED) {
      fail(`${label}: open-ended questions are not supported here.`);
    }
    validateQuizQuestion(interjection.question, label);
  });
}

function validateJournalContent(
  content: JournalContent | undefined,
  title: string,
): void {
  if (!content?.prompts || content.prompts.length === 0) {
    fail(`Journal component "${title}" must have at least one prompt.`);
  }
  const seen = new Set<string>();
  for (const prompt of content.prompts) {
    if (!prompt.id) fail(`Journal component "${title}": prompt missing id.`);
    if (seen.has(prompt.id)) {
      fail(`Journal component "${title}": duplicate prompt id ${prompt.id}.`);
    }
    seen.add(prompt.id);
    if (!prompt.prompt || !prompt.prompt.trim()) {
      fail(`Journal component "${title}" has an empty prompt.`);
    }
  }
}

/**
 * A game carries no answer key and no threshold, so the only thing that can be
 * wrong is the game itself — an unknown key would leave the learner staring at
 * an empty frame.
 */
export function validateGameContent(
  content: GameContent | undefined,
  title: string,
): void {
  const label = `Game component "${title}"`;
  if (!content?.gameKey) {
    fail(`${label} must have a game selected.`);
  }
  if (!Object.values(TrackGameKey).includes(content.gameKey)) {
    fail(`${label} refers to a game that is not available.`);
  }
  if (content.intro !== undefined && typeof content.intro !== 'string') {
    fail(`${label}: intro must be text.`);
  }
}

export function validateAnnotationContent(
  content: AnnotationContent | undefined,
  title: string,
): void {
  const label = `Annotation component "${title}"`;
  if (!content?.settings) {
    fail(`${label} is missing settings.`);
  }
  if (!Object.values(AnnotationArtifactKind).includes(content.kind)) {
    fail(`${label} has an invalid artifact kind.`);
  }

  const { units, labels, targets, settings } = content;

  if (!units || units.length === 0) {
    fail(`${label} must have at least one line to annotate.`);
  }
  if (units.length > TRACK_MAX_ANNOTATION_UNITS) {
    fail(`${label} can have at most ${TRACK_MAX_ANNOTATION_UNITS} lines.`);
  }
  const unitIds = new Set<string>();
  for (const unit of units) {
    if (!unit.id) fail(`${label}: a line is missing its id.`);
    if (unitIds.has(unit.id)) fail(`${label}: duplicate line id ${unit.id}.`);
    unitIds.add(unit.id);
    if (!unit.text || !unit.text.trim()) {
      fail(`${label}: a line has no text.`);
    }
  }

  if (!labels || labels.length === 0) {
    fail(`${label} must have at least one label.`);
  }
  if (labels.length > TRACK_MAX_ANNOTATION_LABELS) {
    fail(`${label} can have at most ${TRACK_MAX_ANNOTATION_LABELS} labels.`);
  }
  const labelIds = new Set<string>();
  for (const item of labels) {
    if (!item.id) fail(`${label}: a label is missing its id.`);
    if (labelIds.has(item.id)) fail(`${label}: duplicate label id ${item.id}.`);
    labelIds.add(item.id);
    if (!item.text || !item.text.trim()) {
      fail(`${label}: a label has no text.`);
    }
    if (!Object.values(AnnotationSwatch).includes(item.color)) {
      fail(`${label}: label "${item.text}" has an invalid colour.`);
    }
  }

  if (!targets || targets.length === 0) {
    fail(`${label} must mark at least one line as part of the answer.`);
  }
  const targetKeys = new Set<string>();
  for (const target of targets) {
    if (!unitIds.has(target.unitId)) {
      fail(`${label}: an answer references a line that no longer exists.`);
    }
    if (!labelIds.has(target.labelId)) {
      fail(`${label}: an answer references a label that no longer exists.`);
    }
    const key = markKey(target.unitId, target.labelId);
    if (targetKeys.has(key)) {
      fail(`${label}: the same line is marked twice with the same label.`);
    }
    targetKeys.add(key);
    if (
      target.points !== undefined &&
      (typeof target.points !== 'number' || target.points <= 0)
    ) {
      fail(`${label}: answer points must be a positive number.`);
    }
  }

  if (
    typeof settings.passScore !== 'number' ||
    settings.passScore < 0 ||
    settings.passScore > 100
  ) {
    fail(`${label}: passScore must be between 0 and 100.`);
  }
  if (
    settings.maxAttempts !== undefined &&
    settings.maxAttempts !== null &&
    (!Number.isInteger(settings.maxAttempts) || settings.maxAttempts < 1)
  ) {
    fail(`${label}: maxAttempts must be a positive integer.`);
  }
  if (
    typeof settings.falsePositivePenalty !== 'number' ||
    settings.falsePositivePenalty < 0
  ) {
    fail(`${label}: the wrong-mark penalty cannot be negative.`);
  }
  if (
    settings.revealKey !== undefined &&
    !Object.values(AnnotationRevealKey).includes(settings.revealKey)
  ) {
    fail(`${label}: invalid answer-reveal setting.`);
  }
}

export function validateQuizContent(
  content: QuizContent | undefined,
  title: string,
): void {
  if (!content?.settings) {
    fail(`Quiz component "${title}" is missing settings.`);
  }
  const { settings, questions } = content;
  if (
    typeof settings.passScore !== 'number' ||
    settings.passScore < 0 ||
    settings.passScore > 100
  ) {
    fail(`Quiz component "${title}": passScore must be between 0 and 100.`);
  }
  if (
    settings.maxAttempts !== undefined &&
    settings.maxAttempts !== null &&
    (!Number.isInteger(settings.maxAttempts) || settings.maxAttempts < 1)
  ) {
    fail(`Quiz component "${title}": maxAttempts must be a positive integer.`);
  }
  if (
    settings.showExplanations !== undefined &&
    !Object.values(QuizShowExplanations).includes(settings.showExplanations)
  ) {
    fail(`Quiz component "${title}": invalid showExplanations value.`);
  }
  if (!questions || questions.length === 0) {
    fail(`Quiz component "${title}" must have at least one question.`);
  }
  if (questions.length > TRACK_MAX_QUIZ_QUESTIONS) {
    fail(
      `Quiz component "${title}" can have at most ${TRACK_MAX_QUIZ_QUESTIONS} questions.`,
    );
  }

  const seenIds = new Set<string>();
  questions.forEach((question, index) => {
    const label = `Quiz "${title}" question ${index + 1}`;
    if (!question.id) fail(`${label}: missing id.`);
    if (seenIds.has(question.id))
      fail(`${label}: duplicate id ${question.id}.`);
    seenIds.add(question.id);
    if (!question.prompt || !question.prompt.trim()) {
      // fill_blank carries its text in `template` instead
      if (question.type !== QuizQuestionType.FILL_BLANK) {
        fail(`${label}: missing prompt.`);
      }
    }
    if (
      question.points !== undefined &&
      (typeof question.points !== 'number' || question.points <= 0)
    ) {
      fail(`${label}: points must be a positive number.`);
    }
    validateQuizQuestion(question, label);
  });
}

/**
 * A question's optional picture or clip. Reached from `validateQuizQuestion`,
 * so it covers quiz questions, video interjections and inline article
 * questions on identical terms — media lives on `QuizQuestionBase`, and a
 * field validated in only one of the three places is a field that arrives
 * unchecked from the other two.
 *
 * The `https` requirement is not pedantry: this URL is handed straight to an
 * `<img src>` / `<iframe src>` on three clients, so anything that is not a
 * fetchable web URL is either broken or an injection attempt.
 */
function validateQuestionMedia(media: QuestionMedia, label: string): void {
  if (!Object.values(QuestionMediaKind).includes(media.kind)) {
    fail(`${label}: media must be an image or a video.`);
  }
  if (!Object.values(QuestionMediaSource).includes(media.source)) {
    fail(`${label}: media has an unknown source.`);
  }
  if (typeof media.url !== 'string' || !media.url.trim()) {
    fail(`${label}: media is missing its URL.`);
  }
  if (!media.url.trim().startsWith('https://')) {
    fail(`${label}: media URL must be an https link.`);
  }
  // There is no "embed an image" concept — an image is always a file the
  // trainer uploaded — so an image claiming a video host is a malformed
  // payload, not a shape we should start rendering.
  if (
    media.kind === QuestionMediaKind.IMAGE &&
    media.source !== QuestionMediaSource.S3
  ) {
    fail(`${label}: an image must be an uploaded file.`);
  }
  if (media.posterUrl !== undefined) {
    if (
      typeof media.posterUrl !== 'string' ||
      !media.posterUrl.trim().startsWith('https://')
    ) {
      fail(`${label}: media thumbnail must be an https link.`);
    }
    // A poster for a still image is meaningless, and an embed brings its
    // own — so a poster anywhere but on an uploaded video is a payload we
    // did not write and should not start rendering.
    if (
      media.kind !== QuestionMediaKind.VIDEO ||
      media.source !== QuestionMediaSource.S3
    ) {
      fail(`${label}: only an uploaded video can have a thumbnail.`);
    }
  }
  if (media.alt !== undefined) {
    if (typeof media.alt !== 'string') {
      fail(`${label}: media description must be text.`);
    }
    if (media.alt.length > TRACK_MAX_QUESTION_MEDIA_ALT_LENGTH) {
      fail(
        `${label}: media description must be ${TRACK_MAX_QUESTION_MEDIA_ALT_LENGTH} characters or fewer.`,
      );
    }
  }
}

function validateQuizQuestion(question: QuizQuestion, label: string): void {
  if (question.media !== undefined && question.media !== null) {
    validateQuestionMedia(question.media, label);
  }
  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
      return validateMcqSingle(question, label);
    case QuizQuestionType.MCQ_MULTI:
      return validateMcqMulti(question, label);
    case QuizQuestionType.TRUE_FALSE:
      return validateTrueFalse(question, label);
    case QuizQuestionType.ORDERING:
      return validateOrdering(question, label);
    case QuizQuestionType.MATCHING:
      return validateMatching(question, label);
    case QuizQuestionType.FILL_BLANK:
      return validateFillBlank(question, label);
    case QuizQuestionType.OPEN_ENDED:
      return validateOpenEnded(question, label);
    default:
      fail(`${label}: unknown question type.`);
  }
}

function assertOptions(
  options: { id: string; text: string }[] | undefined,
  label: string,
  minCount: number,
  name = 'option',
): void {
  if (!options || options.length < minCount) {
    fail(`${label}: needs at least ${minCount} ${name}s.`);
  }
  const seen = new Set<string>();
  for (const option of options) {
    if (!option.id) fail(`${label}: ${name} missing id.`);
    if (seen.has(option.id)) fail(`${label}: duplicate ${name} id.`);
    seen.add(option.id);
    if (!option.text || !option.text.trim()) {
      fail(`${label}: ${name} text cannot be empty.`);
    }
  }
}

function validateMcqSingle(question: McqSingleQuestion, label: string): void {
  assertOptions(question.options, label, 2);
  const optionIds = new Set(question.options.map((o) => o.id));
  if (!question.correctOptionIds || question.correctOptionIds.length !== 1) {
    fail(`${label}: must have exactly one correct option.`);
  }
  if (!optionIds.has(question.correctOptionIds[0])) {
    fail(`${label}: correct option id does not match any option.`);
  }
}

function validateMcqMulti(question: McqMultiQuestion, label: string): void {
  assertOptions(question.options, label, 2);
  const optionIds = new Set(question.options.map((o) => o.id));
  if (!question.correctOptionIds || question.correctOptionIds.length === 0) {
    fail(`${label}: must have at least one correct option.`);
  }
  for (const id of question.correctOptionIds) {
    if (!optionIds.has(id)) {
      fail(`${label}: correct option id ${id} does not match any option.`);
    }
  }
}

function validateTrueFalse(question: TrueFalseQuestion, label: string): void {
  if (typeof question.correctAnswer !== 'boolean') {
    fail(`${label}: correctAnswer must be true or false.`);
  }
}

function validateOrdering(question: OrderingQuestion, label: string): void {
  assertOptions(question.items, label, 2, 'item');
  const itemIds = question.items.map((i) => i.id);
  if (
    !question.correctOrder ||
    question.correctOrder.length !== itemIds.length ||
    new Set(question.correctOrder).size !== itemIds.length ||
    !question.correctOrder.every((id) => itemIds.includes(id))
  ) {
    fail(`${label}: correctOrder must be a permutation of the item ids.`);
  }
}

function validateMatching(question: MatchingQuestion, label: string): void {
  assertOptions(question.left, label, 1, 'left item');
  assertOptions(question.right, label, 1, 'right item');
  if (!question.correctPairs || question.correctPairs.length === 0) {
    fail(`${label}: must define at least one correct pair.`);
  }
  const leftIds = new Set(question.left.map((o) => o.id));
  const rightIds = new Set(question.right.map((o) => o.id));
  const usedLeft = new Set<string>();
  const usedRight = new Set<string>();
  for (const pair of question.correctPairs) {
    if (!leftIds.has(pair.leftId) || !rightIds.has(pair.rightId)) {
      fail(`${label}: pair references an unknown left/right id.`);
    }
    if (usedLeft.has(pair.leftId) || usedRight.has(pair.rightId)) {
      fail(`${label}: each item can appear in only one pair.`);
    }
    usedLeft.add(pair.leftId);
    usedRight.add(pair.rightId);
  }
}

function validateFillBlank(question: FillBlankQuestion, label: string): void {
  if (!question.template || !question.template.trim()) {
    fail(`${label}: missing template.`);
  }
  if (!question.blanks || question.blanks.length === 0) {
    fail(`${label}: must define at least one blank.`);
  }
  const seen = new Set<string>();
  for (const blank of question.blanks) {
    if (!blank.id) fail(`${label}: blank missing id.`);
    if (seen.has(blank.id)) fail(`${label}: duplicate blank id ${blank.id}.`);
    seen.add(blank.id);
    if (!question.template.includes(`{{${blank.id}}}`)) {
      fail(`${label}: template is missing the {{${blank.id}}} token.`);
    }
    if (
      !blank.acceptedAnswers ||
      blank.acceptedAnswers.length === 0 ||
      blank.acceptedAnswers.some((a) => !a || !a.trim())
    ) {
      fail(`${label}: blank ${blank.id} needs at least one accepted answer.`);
    }
  }
}

function validateOpenEnded(question: OpenEndedQuestion, label: string): void {
  if (!question.rubric?.guidance || !question.rubric.guidance.trim()) {
    fail(`${label}: open-ended questions need grading guidance.`);
  }
  if (
    typeof question.rubric.maxScore !== 'number' ||
    question.rubric.maxScore <= 0
  ) {
    fail(`${label}: rubric maxScore must be a positive number.`);
  }
}

/**
 * Structural signature used to enforce the publish-lock rule: while a track
 * has enrollments, edits that change this signature are rejected (content-safe
 * edits — titles, article html, explanations, prompt text — do not change it).
 */
export function computeStructuralSignature(
  sections: UpsertTrackSectionDto[],
): string {
  const signature = sections
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((section) => ({
      id: section.id ?? 'new',
      order: section.order,
      items: section.items
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          id: item.id ?? 'new',
          order: item.order,
          type: item.type,
          scenarioId: item.scenarioId ?? null,
          caseId: item.caseId ?? null,
          quiz: quizStructuralSignature(item),
          article: articleStructuralSignature(item),
          annotation: annotationStructuralSignature(item),
          game: gameStructuralSignature(item),
          video: videoStructuralSignature(item),
          completionCriteria: item.completionCriteria ?? null,
        })),
    }));
  return JSON.stringify(signature);
}

/**
 * Structural for an article: the inline questions' ids and answer keys.
 * Deleting a question orphans the learner's stored
 * `answeredArticleQuestions` entry and moves the completion bar under them,
 * and changing which option is correct re-marks an answer they already gave.
 * The prose — the body HTML, prompts, option text — stays content-safe, so
 * fixing a typo mid-course is still allowed.
 */
function articleStructuralSignature(item: UpsertTrackItemDto): unknown {
  if (item.type !== TrackItemType.ARTICLE || !item.content) return null;
  const article = item.content as ArticleContent;
  return {
    questions: (article.questions ?? []).map((question) =>
      quizQuestionStructuralSignature(question),
    ),
  };
}

/**
 * Structural for an annotation: the id sets (removing a line orphans stored
 * marks), the whole answer key, and anything that changes the score. Prose —
 * line text, label wording, swatches, target notes, the intro, the reveal
 * setting — stays content-safe, so fixing a typo in a transcript mid-course is
 * allowed while deleting the line is not.
 */
function annotationStructuralSignature(item: UpsertTrackItemDto): unknown {
  if (item.type !== TrackItemType.ANNOTATED_ARTIFACT || !item.content) {
    return null;
  }
  const annotation = item.content as AnnotationContent;
  return {
    kind: annotation.kind,
    unitIds: (annotation.units ?? []).map((unit) => unit.id),
    labelIds: (annotation.labels ?? []).map((label) => label.id),
    targets: (annotation.targets ?? [])
      .map((target) => ({
        unitId: target.unitId,
        labelId: target.labelId,
        points: target.points ?? 1,
      }))
      .sort((a, b) =>
        markKey(a.unitId, a.labelId).localeCompare(
          markKey(b.unitId, b.labelId),
        ),
      ),
    passScore: annotation.settings?.passScore,
    maxAttempts: annotation.settings?.maxAttempts ?? null,
    falsePositivePenalty: annotation.settings?.falsePositivePenalty ?? 0,
  };
}

/**
 * Swapping which game an item runs mid-course changes what the learner is
 * looking at, so it is structural. The intro is prose and stays content-safe.
 */
function gameStructuralSignature(item: UpsertTrackItemDto): unknown {
  if (item.type !== TrackItemType.GAME || !item.content) return null;
  return { gameKey: (item.content as GameContent).gameKey };
}

/**
 * Answer-key-only signature for a single quiz question, shared by the quiz
 * item's own signature and by video interjections (which each carry one full
 * question). Prompt/explanation text is deliberately excluded — it stays
 * content-safe.
 */
function quizQuestionStructuralSignature(question: QuizQuestion): unknown {
  return {
    id: question.id,
    type: question.type,
    correct:
      (question as McqSingleQuestion | McqMultiQuestion).correctOptionIds ??
      (question as TrueFalseQuestion).correctAnswer ??
      (question as OrderingQuestion).correctOrder ??
      (question as MatchingQuestion).correctPairs ??
      (question as FillBlankQuestion).blanks?.map((b) => ({
        id: b.id,
        acceptedAnswers: b.acceptedAnswers,
        caseSensitive: b.caseSensitive ?? false,
      })) ??
      null,
  };
}

function quizStructuralSignature(item: UpsertTrackItemDto): unknown {
  if (item.type !== TrackItemType.QUIZ || !item.content) return null;
  const quiz = item.content as QuizContent;
  return {
    passScore: quiz.settings?.passScore,
    maxAttempts: quiz.settings?.maxAttempts ?? null,
    questions: (quiz.questions ?? []).map((question) =>
      quizQuestionStructuralSignature(question),
    ),
  };
}

/**
 * Structural for a video: the source (switching away from S3 would strand
 * interjections the player can no longer pause for) plus each interjection's
 * timestamp and answer key. Interjection ids are included so deleting one
 * (which would orphan any stored `answeredInterjections` entry) is structural
 * too; the question's prompt/explanation text stays content-safe.
 */
function videoStructuralSignature(item: UpsertTrackItemDto): unknown {
  if (item.type !== TrackItemType.VIDEO || !item.content) return null;
  const video = item.content as VideoContent;
  return {
    source: video.source,
    interjections: (video.interjections ?? []).map(
      (interjection: VideoInterjection) => ({
        id: interjection.id,
        timestampSeconds: interjection.timestampSeconds,
        question: quizQuestionStructuralSignature(interjection.question),
      }),
    ),
  };
}
