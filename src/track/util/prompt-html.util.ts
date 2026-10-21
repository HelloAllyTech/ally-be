import { BadRequestException } from '@nestjs/common';
import {
  htmlToPlainText,
  sanitizeDescriptionHtml,
} from 'src/common/util/sanitize-html.util';
import {
  ArticleContent,
  JournalContent,
  TrackItemType,
  VideoContent,
} from '../type/track.type';
import { QuizContent } from '../type/quiz.type';

/** Anything that carries a plain `prompt` and an optional rich `promptHtml`. */
interface PromptCarrier {
  id?: string;
  prompt?: string;
  promptHtml?: string | null;
}

/** What was stored for a prompt before this save, keyed by its id. */
type StoredPrompts = Map<string, { prompt?: string; promptHtml?: string }>;

/** The prompt carriers of one item's content, whatever its type. */
function promptCarriers(
  type: TrackItemType,
  content: unknown,
): PromptCarrier[] {
  if (!content || typeof content !== 'object') return [];
  switch (type) {
    case TrackItemType.QUIZ:
      return asArray((content as QuizContent).questions);
    case TrackItemType.ARTICLE:
      return asArray((content as ArticleContent).questions);
    case TrackItemType.VIDEO:
      return asArray((content as VideoContent).interjections)
        .map((interjection) => interjection?.question)
        .filter(Boolean) as PromptCarrier[];
    case TrackItemType.JOURNAL:
      return asArray((content as JournalContent).prompts);
    default:
      return [];
  }
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function storedPromptsOf(
  type: TrackItemType,
  content: unknown,
): StoredPrompts {
  const stored: StoredPrompts = new Map();
  for (const carrier of promptCarriers(type, content)) {
    if (carrier?.id) {
      stored.set(carrier.id, {
        prompt: carrier.prompt,
        promptHtml: carrier.promptHtml ?? undefined,
      });
    }
  }
  return stored;
}

/**
 * Keeps `prompt` (plain text) and `promptHtml` (sanitized rich text) in step
 * on a save. Mutates `content` in place.
 *
 * `promptHtml` is the source of truth when it changed: it is sanitized and
 * `prompt` is re-derived from it. When `promptHtml` came back byte-for-byte
 * what is already stored but `prompt` was edited, the writer only knows the
 * plain field (the Course Copilot reads the whole content, rewrites `prompt`
 * and sends it all back, as does any client older than this field). Deriving
 * from the stale HTML would silently revert that edit, so the plain edit wins
 * and the stale HTML is dropped — the question simply loses its formatting.
 *
 * Runs before structural validation so that an empty rich prompt is caught as
 * an empty `prompt`.
 */
export function applyPromptHtml(
  type: TrackItemType,
  content: unknown,
  stored?: StoredPrompts,
): void {
  for (const carrier of promptCarriers(type, content)) {
    if (!carrier || typeof carrier !== 'object') continue;
    const html = carrier.promptHtml;
    if (html === undefined || html === null) continue;
    if (typeof html !== 'string') {
      throw new BadRequestException('promptHtml must be a string');
    }
    const sanitized = sanitizeDescriptionHtml(html);
    const before = carrier.id ? stored?.get(carrier.id) : undefined;
    const htmlUnchanged = before?.promptHtml === sanitized;
    if (
      htmlUnchanged &&
      typeof carrier.prompt === 'string' &&
      carrier.prompt !== before?.prompt
    ) {
      delete carrier.promptHtml;
      continue;
    }
    carrier.promptHtml = sanitized;
    carrier.prompt = htmlToPlainText(sanitized);
  }
}
