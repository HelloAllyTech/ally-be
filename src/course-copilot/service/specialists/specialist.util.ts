import { BadRequestException } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { validateTrackItemContent } from 'src/track/service/track-structure.validator';
import { TrackItemType } from 'src/track/type/track.type';
import {
  CourseBlueprint,
  CourseBlueprintItem,
  CourseBrief,
} from '../../type/course-copilot.type';
import { COURSE_BLUEPRINT_ITEM_TYPE_LABELS } from '../../util/course-blueprint.util';
import { SpecialistValidationError } from './specialist.types';

/**
 * Output ceilings per specialist call.
 *
 * Generous on purpose: on OpenAI reasoning models `maxTokens` becomes
 * `max_completion_tokens`, which counts the hidden reasoning tokens as well as
 * the JSON. A ceiling sized for the visible output alone truncates the JSON
 * mid-object, which surfaces as "The model did not return JSON" and burns the
 * repair pass. The ceiling is not spend — a call pays for what it uses.
 */
export const SPECIALIST_MAX_TOKENS = {
  BLUEPRINT: 16_000,
  ARTICLE: 12_000,
  QUIZ: 12_000,
  ANNOTATION: 14_000,
  JOURNAL: 3_000,
  META: 3_000,
  REVIEW: 12_000,
  IMAGE_PROMPT: 2_000,
  LANDING_PAGE: 10_000,
} as const;

/** Item types a learner "does" — the practice a journal reflects on. */
export const PRACTICE_ITEM_TYPES: ReadonlySet<string> = new Set([
  TrackItemType.ROLEPLAY,
  TrackItemType.CASE,
  TrackItemType.ANNOTATED_ARTIFACT,
]);

// ── Coercion ────────────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, any> {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

/** Trimmed text from a string or number; anything else is ''. */
export function asText(value: unknown, maxLength?: number): string {
  let text = '';
  if (typeof value === 'string') text = value.trim();
  else if (typeof value === 'number' && Number.isFinite(value)) {
    text = String(value);
  }
  if (maxLength && text.length > maxLength) {
    text = truncateAtWord(text, maxLength);
  }
  return text;
}

/** Cut to at most `maxLength` characters, at a word boundary where one exists. */
export function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut)
    .replace(/[\s,;:–—-]+$/, '')
    .trim();
}

/** A finite number from a number or numeric string, else undefined. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return undefined;
}

export function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const parsed = asNumber(value);
  if (parsed === undefined) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function plural(count: number, singular: string, many?: string): string {
  return `${count} ${count === 1 ? singular : (many ?? `${singular}s`)}`;
}

/** Visible text of an html fragment, whitespace-collapsed. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function countWords(text: string): number {
  const trimmed = (text ?? '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** Comparison key for loose text matching: case, spacing and punctuation folded. */
export function foldText(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Which options the model marked correct, as new ids. Models give the key as
 * ids, as the option text, or as an index; all three are accepted.
 */
export function resolveCorrectOptions(
  raw: Record<string, any>,
  options: { id: string; text: string }[],
  optionIdMap: Map<string, string>,
): string[] {
  const given = [
    raw.correctOptionIds,
    raw.correctOptionId,
    raw.correctAnswer,
    raw.answer,
    raw.correctIndex,
  ].find((value) => value !== undefined && value !== null);
  const keys = Array.isArray(given)
    ? given
    : given === undefined
      ? []
      : [given];
  const resolved = new Set<string>();
  const lowerIdMap = new Map(
    Array.from(optionIdMap.entries()).map(([rawId, id]) => [
      rawId.toLowerCase(),
      id,
    ]),
  );
  for (const key of keys) {
    if (typeof key === 'string') {
      const byId =
        optionIdMap.get(key.trim()) ?? lowerIdMap.get(key.trim().toLowerCase());
      if (byId) {
        resolved.add(byId);
        continue;
      }
    }
    if (typeof key === 'string') {
      const byText = options.find(
        (option) => foldText(option.text) === foldText(key),
      );
      if (byText) {
        resolved.add(byText.id);
        continue;
      }
    }
    if (typeof key === 'number' && Number.isInteger(key) && options[key]) {
      resolved.add(options[key].id);
    }
  }
  return Array.from(resolved);
}

// ── Ids ─────────────────────────────────────────────────────────────────────

/**
 * Mints the ids a specialist writes into item content.
 *
 * Models mint ids like "q1" and "a", repeat them across questions, and reuse
 * them inconsistently, so every id in generated content is replaced with a
 * uuid v4 — the track stores ids the client never chose (plan §5.6) and only
 * fills quiz option ids itself.
 *
 * `keep` is the one exception: on a regeneration, ids already present in the
 * item's current content survive when the model echoes them back. Learner
 * progress and the structural signature of an enrolled course are keyed on
 * those ids, so a "reword question 3" regenerate that re-minted every id would
 * orphan answers and trip the enrolment lock for a content-only change.
 */
export class IdMinter {
  private readonly used = new Set<string>();

  constructor(private readonly keep: ReadonlySet<string> = new Set()) {}

  mint(raw?: unknown): string {
    const candidate = asText(raw);
    if (candidate && this.keep.has(candidate) && !this.used.has(candidate)) {
      this.used.add(candidate);
      return candidate;
    }
    let id = uuidv4();
    while (this.used.has(id)) id = uuidv4();
    this.used.add(id);
    return id;
  }
}

/** Every value of an `id` key anywhere in `value` — the ids a regeneration may keep. */
export function collectContentIds(
  value: unknown,
  into: Set<string> = new Set(),
): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectContentIds(entry, into));
  } else if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'id' && typeof entry === 'string' && entry.trim()) {
        into.add(entry.trim());
      } else {
        collectContentIds(entry, into);
      }
    }
  }
  return into;
}

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Run the track's own validator — the same one `upsertStructure` will run —
 * and hand its message back as repair-pass input instead of a 400.
 */
export function assertTrackItemContent(
  type: TrackItemType,
  content: unknown,
  title: string,
): void {
  try {
    validateTrackItemContent({ type, content, title });
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw new SpecialistValidationError([error.message]);
    }
    throw error;
  }
}

export function assertNoProblems(problems: string[]): void {
  if (problems.length > 0) throw new SpecialistValidationError(problems);
}

// ── Prompt context ──────────────────────────────────────────────────────────

export function briefForPrompt(brief: CourseBrief): string {
  return JSON.stringify(brief ?? {}, null, 2);
}

/**
 * The blueprint as a short outline, with this item marked, so a specialist
 * knows what comes before and after it without reading anyone else's content.
 */
export function courseOutlineForPrompt(
  blueprint: CourseBlueprint,
  currentItemId?: string,
): string {
  const lines: string[] = [];
  (blueprint?.sections ?? []).forEach((section, sectionIndex) => {
    lines.push(
      `Section ${sectionIndex + 1}: ${section.title || '(untitled)'}` +
        (section.purpose ? ` — ${section.purpose}` : ''),
    );
    (section.items ?? []).forEach((item, itemIndex) => {
      const here = item.id === currentItemId;
      lines.push(
        `  ${here ? '→ ' : ''}${sectionIndex + 1}.${itemIndex + 1} ` +
          `[${typeLabel(item.type)}] ${item.title || '(untitled)'}` +
          (item.purpose ? ` — ${item.purpose}` : '') +
          (here ? '   ← THIS ITEM' : ''),
      );
    });
  });
  return lines.join('\n') || '(no outline)';
}

export function itemForPrompt(item: CourseBlueprintItem): string {
  return JSON.stringify(
    {
      type: item.type,
      title: item.title,
      purpose: item.purpose,
      estimatedMinutes: item.estimatedMinutes,
      spec: item.spec ?? {},
      completionCriteria: item.completionCriteria ?? {},
    },
    null,
    2,
  );
}

/**
 * The enabling outcomes this item serves, as a list. Falls back to the
 * terminal outcome so a specialist always writes towards something stated.
 */
export function objectivesForPrompt(
  brief: CourseBrief,
  item: CourseBlueprintItem,
): string {
  const enabling = brief?.outcomes?.enabling ?? [];
  const picked = (item.objectiveRefs ?? [])
    .filter((index) => Number.isInteger(index) && enabling[index])
    .map((index) => `- ${enabling[index]}`);
  if (picked.length) return picked.join('\n');
  if (brief?.outcomes?.terminal) {
    return `- ${brief.outcomes.terminal} (the course's overall outcome)`;
  }
  return '- (no outcome recorded — infer it from the item purpose)';
}

export function typeLabel(type: string): string {
  return (
    COURSE_BLUEPRINT_ITEM_TYPE_LABELS[type as TrackItemType] ?? String(type)
  );
}

/** One line describing an item, for "what comes before / after this". */
export function describeItemForPrompt(item: CourseBlueprintItem): string {
  const spec = item.spec ?? {};
  const parts = [`[${typeLabel(item.type)}] "${item.title}"`];
  if (item.purpose) parts.push(`— ${item.purpose}`);
  if (typeof spec.personaBrief === 'string' && spec.personaBrief.trim()) {
    parts.push(`Client: ${spec.personaBrief.trim()}`);
  }
  if (typeof spec.taskClass === 'string' && spec.taskClass.trim()) {
    parts.push(`Difficulty: ${spec.taskClass.trim()}`);
  }
  if (typeof spec.focus === 'string' && spec.focus.trim()) {
    parts.push(`Focus: ${spec.focus.trim()}`);
  }
  return parts.join(' ');
}

function flattenItems(blueprint: CourseBlueprint): CourseBlueprintItem[] {
  return (blueprint?.sections ?? []).flatMap((section) => section.items ?? []);
}

/**
 * The practice block a journal follows: the run of roleplays / cases /
 * annotated transcripts immediately before it (games between them are
 * skipped). When the journal follows something else, that one item.
 */
export function precedingPracticeBlock(
  blueprint: CourseBlueprint,
  itemId: string,
): CourseBlueprintItem[] {
  const items = flattenItems(blueprint);
  const index = items.findIndex((candidate) => candidate.id === itemId);
  if (index <= 0) return [];
  const block: CourseBlueprintItem[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = items[cursor];
    if (candidate.type === TrackItemType.GAME) continue;
    if (PRACTICE_ITEM_TYPES.has(candidate.type)) {
      block.unshift(candidate);
      continue;
    }
    if (block.length === 0) block.push(candidate);
    break;
  }
  return block;
}

/** The next practice or assessment item after this one in the same section. */
export function nextPracticeInSection(
  blueprint: CourseBlueprint,
  itemId: string,
): CourseBlueprintItem | undefined {
  const section = (blueprint?.sections ?? []).find((candidate) =>
    (candidate.items ?? []).some((item) => item.id === itemId),
  );
  if (!section) return undefined;
  const index = section.items.findIndex((item) => item.id === itemId);
  return section.items
    .slice(index + 1)
    .find(
      (item) =>
        PRACTICE_ITEM_TYPES.has(item.type) || item.type === TrackItemType.QUIZ,
    );
}
