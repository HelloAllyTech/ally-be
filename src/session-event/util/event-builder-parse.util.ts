import { parseFirstJsonObject } from 'src/learn/util/autofill-shared.util';

import {
  DEFAULT_EXAMPLES_PER_POLARITY,
  EventBuilderField,
  MAX_EVENT_SCORE,
  MAX_EXAMPLES_PER_POLARITY,
  MAX_GENERATED_TAGS,
  MIN_EVENT_SCORE,
} from '../enum/event-builder-field.enum';

/**
 * Coercion for Event Builder's raw model output.
 *
 * Every parser here is total: an unusable answer yields an empty/blank value
 * rather than throwing, because a field is one of several parallel calls and
 * one bad JSON response must not take the batch down — the client shows that
 * row as "no content generated" and the author fills it in. Nothing is trusted
 * on shape: the values are written into a form the author submits to the normal
 * create/update endpoints, and those endpoints do not re-check the model's
 * arithmetic.
 *
 * Kept out of the service so the clamping rules can be tested without standing
 * up an LLM or the DI graph.
 */

/** Longest generated event name / class name, matching the studio's inputs. */
const MAX_NAME_LENGTH = 120;
const MAX_CLASS_NAME_LENGTH = 200;
/** One short sentence on screen mid-session — not a paragraph. */
const MAX_MESSAGE_LENGTH = 300;
const MAX_BRANCH_INSTRUCTION_LENGTH = 1000;
const MAX_TAG_LENGTH = 40;
const MAX_EXAMPLE_LENGTH = 300;

export interface ParsedClassifier {
  name: string;
  className: string;
}

export interface ParsedExample {
  text: string;
}

export interface ParsedExamples {
  positiveExamples: ParsedExample[];
  negativeExamples: ParsedExample[];
}

export interface ParsedFeedback {
  message: string;
  /**
   * Absent when the model returned something that is not an emoji. The client
   * keeps its own default (🫥) rather than being handed the word "smile".
   */
  emoji?: string;
  score: number;
}

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/** Collapse to one line and strip wrapping quotes — used for label-ish fields. */
const oneLine = (value: string, maxLength: number): string =>
  value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
    .slice(0, maxLength);

/**
 * Find the array in a model response whatever key it landed under: the
 * documented key first, then a bare array, then the first array-valued
 * property. A minor structural deviation should cost nothing — the same
 * leniency the Agent Builder Copilot applies to knowledge_sources / states.
 */
const arrayAt = (parsed: any, key: string): any[] => {
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.[key])) return parsed[key];
  if (parsed && typeof parsed === 'object') {
    const found = Object.values(parsed).find((v) => Array.isArray(v));
    if (Array.isArray(found)) return found;
  }
  return [];
};

export const parseClassifier = (raw: string): ParsedClassifier => {
  const parsed = parseFirstJsonObject(raw) ?? {};
  const className = oneLine(
    asString(parsed.className) || asString(parsed.class_name),
    MAX_CLASS_NAME_LENGTH,
  );
  // The name is the human label for the same idea; when the model gives only
  // one of the pair, reuse it rather than leaving a blank field.
  const name = oneLine(asString(parsed.name), MAX_NAME_LENGTH) || className;
  return { name, className: className || name };
};

/**
 * Examples, capped and de-duplicated.
 *
 * A text appearing on both sides is dropped from BOTH: it is a direct
 * contradiction in the few-shot block, and there is no way to tell which side
 * the model meant. Silently keeping one would hand the runtime a prompt that
 * argues with itself on every turn.
 */
export const parseExamples = (
  raw: string,
  numExamples: number = DEFAULT_EXAMPLES_PER_POLARITY,
): ParsedExamples => {
  const parsed = parseFirstJsonObject(raw);
  const limit = Math.min(
    Math.max(Math.trunc(numExamples) || DEFAULT_EXAMPLES_PER_POLARITY, 1),
    MAX_EXAMPLES_PER_POLARITY,
  );

  const toTexts = (items: any[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const text = oneLine(
        typeof item === 'string' ? item : asString(item?.text),
        MAX_EXAMPLE_LENGTH,
      );
      if (!text) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
    return out;
  };

  // Read each polarity by name only — no "first array-valued property"
  // fallback here, unlike `tags`. The response carries TWO arrays, so guessing
  // would silently file the negatives as positives, which is worse than
  // returning nothing and letting the author see an empty list.
  const at = (...keys: string[]): any[] => {
    for (const key of keys) {
      if (Array.isArray(parsed?.[key])) return parsed[key];
    }
    return [];
  };
  const positives = toTexts(at('positiveExamples', 'positive_examples'));
  const negatives = toTexts(at('negativeExamples', 'negative_examples'));

  const contested = new Set(
    positives
      .map((t) => t.toLowerCase())
      .filter((t) => negatives.some((n) => n.toLowerCase() === t)),
  );
  const keep = (texts: string[]): ParsedExample[] =>
    texts
      .filter((t) => !contested.has(t.toLowerCase()))
      .slice(0, limit)
      .map((text) => ({ text }));

  return {
    positiveExamples: keep(positives),
    negativeExamples: keep(negatives),
  };
};

/**
 * A single emoji, or nothing.
 *
 * `\p{Extended_Pictographic}` rather than a length check: the field is one
 * grapheme on screen, and a model that answers "thumbs up" or ":)" must not
 * have that written into the event as if it were an emoji.
 */
const asEmoji = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const graphemes = Array.from(trimmed);
  const first = graphemes[0];
  if (!/\p{Extended_Pictographic}/u.test(first)) return undefined;
  // Keep any variation selector / ZWJ sequence attached to the base glyph;
  // slicing to one code point would turn 👩‍⚕️ into 👩.
  return trimmed.slice(0, 8);
};

export const parseFeedback = (raw: string): ParsedFeedback => {
  const parsed = parseFirstJsonObject(raw) ?? {};
  const scoreRaw =
    typeof parsed.score === 'number'
      ? parsed.score
      : typeof parsed.score === 'string' && parsed.score.trim() !== ''
        ? Number(parsed.score)
        : NaN;
  // A non-numeric score means the model did not decide; 0 is the studio's own
  // default for a new event and says "this event carries no score weight",
  // which is the honest reading of a missing answer.
  const score = Number.isFinite(scoreRaw)
    ? Math.min(Math.max(Math.round(scoreRaw), MIN_EVENT_SCORE), MAX_EVENT_SCORE)
    : 0;
  return {
    message: oneLine(asString(parsed.message), MAX_MESSAGE_LENGTH),
    emoji: asEmoji(asString(parsed.emoji)),
    score,
  };
};

export const parseBranchInstruction = (raw: string): string => {
  const parsed = parseFirstJsonObject(raw);
  // Prose field: the prompt asks for plain text, but a model that answers with
  // {"branchInstruction": "..."} anyway should not have its braces written
  // into the actor's instruction.
  const fromJson = asString(
    parsed?.branchInstruction ?? parsed?.branch_instruction,
  );
  return (fromJson || raw).trim().slice(0, MAX_BRANCH_INSTRUCTION_LENGTH);
};

export const parseTags = (raw: string): string[] => {
  const parsed = parseFirstJsonObject(raw);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arrayAt(parsed, 'tags')) {
    const tag = oneLine(
      typeof item === 'string' ? item : asString(item?.name),
      MAX_TAG_LENGTH,
    );
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length === MAX_GENERATED_TAGS) break;
  }
  return out;
};

/** Route a field's raw model output to its parser. */
export const parseEventBuilderField = (
  field: EventBuilderField,
  raw: string,
  numExamples?: number,
): unknown => {
  switch (field) {
    case EventBuilderField.CLASSIFIER:
      return parseClassifier(raw);
    case EventBuilderField.EXAMPLES:
      return parseExamples(raw, numExamples);
    case EventBuilderField.FEEDBACK:
      return parseFeedback(raw);
    case EventBuilderField.BRANCH_INSTRUCTION:
      return parseBranchInstruction(raw);
    case EventBuilderField.TAGS:
      return parseTags(raw);
    default:
      return raw.trim();
  }
};
