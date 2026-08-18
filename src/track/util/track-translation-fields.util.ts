import { createHash } from 'crypto';
import { Track } from '../entity/track.entity';
import { TrackItem } from '../entity/track-item.entity';
import { TrackSection } from '../entity/track-section.entity';
import {
  ArticleContent,
  JournalContent,
  TrackItemType,
} from '../type/track.type';
import { QuizContent, QuizQuestion, QuizQuestionType } from '../type/quiz.type';
import { AnnotationContent } from '../type/annotation.type';
import { GameContent } from '../type/game.type';
import {
  TranslatableField,
  TranslatableFieldKind,
  TranslatedField,
  TranslatedFieldMap,
} from '../type/track-translation.type';

/**
 * The single definition of "what is translatable" in a course, used in both
 * directions: extraction (English -> a list of strings to translate) and
 * application (a stored translation -> a localised entity for the learner).
 *
 * Both directions run the *same* walk, so a field can never be extracted and
 * then not applied, or vice versa. Adding a translatable field to a component
 * type means touching exactly one `walk*` function below.
 *
 * Paths are built from **stable ids** (question id, option id, unit id, label
 * id) rather than array positions, so reordering a quiz does not silently
 * re-point translations at the wrong question. The two exceptions —
 * `acceptedAnswers[i]` and `rubric.criteria[i]`, which are plain arrays with no
 * ids — are keyed by index and rely on {@link hashSource}: if an insertion
 * shifts them, the hashes stop matching and those entries re-translate.
 */

/**
 * Returns the value to write in place of `field.value`, or `undefined` to
 * leave the source untouched (extraction always returns `undefined`).
 */
type FieldVisitor = (field: TranslatableField) => string | undefined;

/**
 * Fields that feed grading. Getting one of these wrong does not just read
 * badly — it changes what counts as a correct answer, so a language cannot be
 * published until a human has confirmed every one of them.
 *
 * Deliberately *not* including annotation `units[]`: grading compares
 * `(unitId, labelId)` sets, so an imperfect unit translation costs
 * comprehension but never relabels the answer key, and a 40-turn transcript
 * would otherwise put 40 mandatory confirmations in front of every publish.
 * The labels — the vocabulary the learner actually picks from — are scoring.
 */
const SCORING_KINDS: ReadonlySet<TranslatableFieldKind> = new Set([
  TranslatableFieldKind.SHORT_ANSWER,
  TranslatableFieldKind.RUBRIC,
  TranslatableFieldKind.BLANK_TEMPLATE,
]);

/**
 * Path segment for an annotation target, which has no id of its own and is
 * identified by the (unit, label) pair it joins.
 *
 * Deliberately independent of `markKey()` in annotation.type, whose separator
 * is an implementation detail of in-memory set comparison and is free to
 * change. These paths are *persisted* as `jsonb` keys, so the separator here is
 * part of the stored format: it has to be stable across releases, and it has to
 * be a character Postgres accepts inside `jsonb` (which rules out the NUL byte
 * `markKey` carried until recently — it renders as a space in most editors,
 * which is how it went unnoticed).
 */
function targetPath(unitId: string, labelId: string): string {
  return `${unitId}:${labelId}`;
}

/** Short, stable digest of an English source string. */
export function hashSource(value: string): string {
  return createHash('sha256').update(value.trim()).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ *
 * Walk definitions
 * ------------------------------------------------------------------ */

interface FieldSpec {
  path: string;
  kind: TranslatableFieldKind;
  get: () => unknown;
  set: (value: string) => void;
  scoring?: boolean;
  context?: string;
}

function visitField(spec: FieldSpec, visit: FieldVisitor): void {
  const value = spec.get();
  if (typeof value !== 'string' || value.trim() === '') return;
  const replacement = visit({
    path: spec.path,
    value,
    kind: spec.kind,
    scoring: spec.scoring ?? SCORING_KINDS.has(spec.kind),
    ...(spec.context ? { context: spec.context } : {}),
  });
  if (typeof replacement === 'string' && replacement.trim() !== '') {
    spec.set(replacement);
  }
}

/** `title` + `description`, shared by tracks, sections and items. */
function walkHeading(
  entity: { title?: string; description?: string },
  visit: FieldVisitor,
  prefix = '',
): void {
  visitField(
    {
      path: `${prefix}title`,
      kind: TranslatableFieldKind.TITLE,
      get: () => entity.title,
      set: (value) => (entity.title = value),
    },
    visit,
  );
  visitField(
    {
      path: `${prefix}description`,
      kind: TranslatableFieldKind.DESCRIPTION,
      get: () => entity.description,
      set: (value) => (entity.description = value),
    },
    visit,
  );
}

function walkQuizQuestion(
  question: QuizQuestion,
  visit: FieldVisitor,
  base: string,
): void {
  const prompt = question.prompt;
  visitField(
    {
      path: `${base}.prompt`,
      kind: TranslatableFieldKind.PROSE,
      get: () => question.prompt,
      set: (value) => (question.prompt = value),
    },
    visit,
  );
  visitField(
    {
      path: `${base}.explanation`,
      kind: TranslatableFieldKind.PROSE,
      get: () => question.explanation,
      set: (value) => (question.explanation = value),
      context: prompt,
    },
    visit,
  );

  /** Shared walk for the `QuizOption[]` collections (options/items/left/right). */
  const walkOptions = (
    collection: string,
    options?: { id: string; text: string }[],
  ) => {
    for (const option of options ?? []) {
      visitField(
        {
          path: `${base}.${collection}[${option.id}].text`,
          kind: TranslatableFieldKind.LABEL,
          get: () => option.text,
          set: (value) => (option.text = value),
          context: prompt,
        },
        visit,
      );
    }
  };

  switch (question.type) {
    case QuizQuestionType.MCQ_SINGLE:
    case QuizQuestionType.MCQ_MULTI:
      walkOptions('options', question.options);
      break;

    case QuizQuestionType.ORDERING:
      walkOptions('items', question.items);
      break;

    case QuizQuestionType.MATCHING:
      walkOptions('left', question.left);
      walkOptions('right', question.right);
      break;

    case QuizQuestionType.FILL_BLANK: {
      // The `{{blankId}}` tokens are load-bearing: the grader splices answers
      // back in by token, so a translation that drops one breaks the question.
      visitField(
        {
          path: `${base}.template`,
          kind: TranslatableFieldKind.BLANK_TEMPLATE,
          get: () => question.template,
          set: (value) => (question.template = value),
          context: prompt,
        },
        visit,
      );
      for (const blank of question.blanks ?? []) {
        blank.acceptedAnswers?.forEach((answer, index) => {
          visitField(
            {
              path: `${base}.blanks[${blank.id}].acceptedAnswers[${index}]`,
              kind: TranslatableFieldKind.SHORT_ANSWER,
              get: () => blank.acceptedAnswers[index],
              set: (value) => (blank.acceptedAnswers[index] = value),
              context: prompt,
            },
            visit,
          );
        });
      }
      break;
    }

    case QuizQuestionType.OPEN_ENDED: {
      visitField(
        {
          path: `${base}.rubric.guidance`,
          kind: TranslatableFieldKind.RUBRIC,
          get: () => question.rubric?.guidance,
          set: (value) => (question.rubric.guidance = value),
          context: prompt,
        },
        visit,
      );
      question.rubric?.criteria?.forEach((criterion, index) => {
        visitField(
          {
            path: `${base}.rubric.criteria[${index}].name`,
            kind: TranslatableFieldKind.RUBRIC,
            get: () => criterion.name,
            set: (value) => (criterion.name = value),
            context: prompt,
          },
          visit,
        );
        visitField(
          {
            path: `${base}.rubric.criteria[${index}].description`,
            kind: TranslatableFieldKind.RUBRIC,
            get: () => criterion.description,
            set: (value) => (criterion.description = value),
            context: prompt,
          },
          visit,
        );
      });
      break;
    }

    case QuizQuestionType.TRUE_FALSE:
      // `correctAnswer` is a boolean; the True/False labels the learner taps
      // are app strings owned by dynamic-i18n, not course content.
      break;
  }
}

function walkQuizContent(content: QuizContent, visit: FieldVisitor): void {
  for (const question of content.questions ?? []) {
    walkQuizQuestion(question, visit, `content.questions[${question.id}]`);
  }
}

function walkAnnotationContent(
  content: AnnotationContent,
  visit: FieldVisitor,
): void {
  visitField(
    {
      path: 'content.intro',
      kind: TranslatableFieldKind.PROSE,
      get: () => content.intro,
      set: (value) => (content.intro = value),
    },
    visit,
  );

  for (const unit of content.units ?? []) {
    visitField(
      {
        path: `content.units[${unit.id}].speaker`,
        kind: TranslatableFieldKind.SPEAKER,
        get: () => unit.speaker,
        set: (value) => (unit.speaker = value),
      },
      visit,
    );
    visitField(
      {
        path: `content.units[${unit.id}].text`,
        kind: TranslatableFieldKind.PROSE,
        get: () => unit.text,
        set: (value) => (unit.text = value),
      },
      visit,
    );
  }

  for (const label of content.labels ?? []) {
    // The label set is the vocabulary the learner picks from — a mistranslated
    // label makes them mark the right unit with the wrong meaning.
    visitField(
      {
        path: `content.labels[${label.id}].text`,
        kind: TranslatableFieldKind.LABEL,
        get: () => label.text,
        set: (value) => (label.text = value),
        scoring: true,
      },
      visit,
    );
    visitField(
      {
        path: `content.labels[${label.id}].description`,
        kind: TranslatableFieldKind.PROSE,
        get: () => label.description,
        set: (value) => (label.description = value),
        scoring: true,
        context: label.text,
      },
      visit,
    );
  }

  for (const target of content.targets ?? []) {
    visitField(
      {
        path: `content.targets[${targetPath(target.unitId, target.labelId)}].note`,
        kind: TranslatableFieldKind.PROSE,
        get: () => target.note,
        set: (value) => (target.note = value),
      },
      visit,
    );
  }
}

function walkJournalContent(
  content: JournalContent,
  visit: FieldVisitor,
): void {
  for (const prompt of content.prompts ?? []) {
    const promptText = prompt.prompt;
    visitField(
      {
        path: `content.prompts[${prompt.id}].prompt`,
        kind: TranslatableFieldKind.PROSE,
        get: () => prompt.prompt,
        set: (value) => (prompt.prompt = value),
      },
      visit,
    );
    visitField(
      {
        path: `content.prompts[${prompt.id}].placeholder`,
        kind: TranslatableFieldKind.LABEL,
        get: () => prompt.placeholder,
        set: (value) => (prompt.placeholder = value),
        context: promptText,
      },
      visit,
    );
  }
}

/**
 * Every translatable string on an item, including its inline content. VIDEO
 * contributes nothing (a URL is not translatable — see
 * `TrackTranslationContent.media`), and ROLEPLAY/CASE contribute only their
 * heading, since the linked scenario and case own their own translations.
 */
function walkItem(item: TrackItem, visit: FieldVisitor): void {
  walkHeading(item, visit);

  if (!item.content) return;

  switch (item.type) {
    case TrackItemType.ARTICLE:
      visitField(
        {
          path: 'content.html',
          kind: TranslatableFieldKind.HTML,
          get: () => (item.content as ArticleContent).html,
          set: (value) => ((item.content as ArticleContent).html = value),
        },
        visit,
      );
      break;

    case TrackItemType.QUIZ:
      walkQuizContent(item.content as QuizContent, visit);
      break;

    case TrackItemType.ANNOTATED_ARTIFACT:
      walkAnnotationContent(item.content as AnnotationContent, visit);
      break;

    case TrackItemType.JOURNAL:
      walkJournalContent(item.content as JournalContent, visit);
      break;

    case TrackItemType.GAME:
      // The game itself is a canvas of sprites with no words in it; the only
      // thing a learner reads is the author's framing line.
      visitField(
        {
          path: 'content.intro',
          kind: TranslatableFieldKind.PROSE,
          get: () => (item.content as GameContent).intro,
          set: (value) => ((item.content as GameContent).intro = value),
        },
        visit,
      );
      break;

    case TrackItemType.VIDEO:
    case TrackItemType.ROLEPLAY:
    case TrackItemType.CASE:
      break;
  }
}

/* ------------------------------------------------------------------ *
 * Extraction
 * ------------------------------------------------------------------ */

function collect(walk: (visit: FieldVisitor) => void): TranslatableField[] {
  const fields: TranslatableField[] = [];
  walk((field) => {
    fields.push(field);
    return undefined;
  });
  return fields;
}

export function extractTrackFields(track: Track): TranslatableField[] {
  return collect((visit) => walkHeading(track, visit));
}

export function extractSectionFields(
  section: TrackSection,
): TranslatableField[] {
  return collect((visit) => walkHeading(section, visit));
}

export function extractItemFields(item: TrackItem): TranslatableField[] {
  // Walk a clone: the visitor never writes during extraction, but cloning
  // makes that structurally impossible rather than merely intended.
  const clone = cloneEntity(item);
  return collect((visit) => walkItem(clone, visit));
}

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

/**
 * Only a field whose stored `sourceHash` still matches the live English is
 * applied. A source edit therefore degrades that one string to English rather
 * than showing the learner a translation of text that no longer exists.
 */
function applier(
  fields: TranslatedFieldMap,
  sourceHashes: Map<string, string>,
): FieldVisitor {
  return (field) => {
    const translated = fields[field.path];
    if (!translated?.value) return undefined;
    const liveHash = hashSource(field.value);
    sourceHashes.set(field.path, liveHash);
    if (translated.sourceHash !== liveHash) return undefined;
    return translated.value;
  };
}

function cloneEntity<T>(entity: T): T {
  return JSON.parse(JSON.stringify(entity)) as T;
}

export function applyTrackFields(
  track: Track,
  fields: TranslatedFieldMap,
): Track {
  const clone = cloneEntity(track);
  walkHeading(clone, applier(fields, new Map()));
  return clone;
}

export function applySectionFields(
  section: TrackSection,
  fields: TranslatedFieldMap,
): TrackSection {
  const clone = cloneEntity(section);
  walkHeading(clone, applier(fields, new Map()));
  return clone;
}

export function applyItemFields(
  item: TrackItem,
  fields: TranslatedFieldMap,
): TrackItem {
  const clone = cloneEntity(item);
  walkItem(clone, applier(fields, new Map()));
  return clone;
}

/* ------------------------------------------------------------------ *
 * Diffing (staleness)
 * ------------------------------------------------------------------ */

export interface FieldDiff {
  /** Fields with no translation yet, or whose English changed and which the
   *  trainer has not hand-edited — safe to (re-)translate automatically. */
  toTranslate: TranslatableField[];
  /** Hand-edited fields whose English changed; the trainer must resolve these. */
  sourceChanged: TranslatableField[];
  /** Paths in the stored translation that no longer exist in the source. */
  orphaned: string[];
  /** Every live path, so callers can size a review queue. */
  livePaths: string[];
}

/**
 * Compares the live English against a stored translation.
 *
 * A hand-edited value is never queued for re-translation — that is the whole
 * point of the `edited` flag — but it *is* reported as `sourceChanged` so the
 * trainer can see their edit may no longer match the English.
 */
export function diffFields(
  live: TranslatableField[],
  stored: TranslatedFieldMap,
): FieldDiff {
  const diff: FieldDiff = {
    toTranslate: [],
    sourceChanged: [],
    orphaned: [],
    livePaths: [],
  };
  const livePaths = new Set<string>();

  for (const field of live) {
    livePaths.add(field.path);
    diff.livePaths.push(field.path);
    const existing = stored[field.path];
    if (!existing) {
      diff.toTranslate.push(field);
      continue;
    }
    if (existing.sourceHash === hashSource(field.value)) continue;
    if (existing.edited) {
      diff.sourceChanged.push(field);
    } else {
      diff.toTranslate.push(field);
    }
  }

  for (const path of Object.keys(stored)) {
    if (!livePaths.has(path)) diff.orphaned.push(path);
  }

  return diff;
}

/** Builds the stored entry for a freshly machine-translated field. */
export function toTranslatedField(
  field: TranslatableField,
  value: string,
): TranslatedField {
  return {
    value,
    sourceHash: hashSource(field.value),
    ...(field.scoring ? { scoring: true } : {}),
  };
}
