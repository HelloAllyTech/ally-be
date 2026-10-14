import { Injectable } from '@nestjs/common';
import * as sanitizeHtml from 'sanitize-html';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { TRACK_MAX_ARTICLE_RESOURCES } from 'src/track/constants/track.constant';
import { QuizQuestionType } from 'src/track/type/quiz.type';
import {
  ArticleContent,
  ArticleQuestion,
  ArticleResource,
  TrackItemType,
} from 'src/track/type/track.type';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_LIMITS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { articleWantsImage } from '../../util/course-blueprint.util';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  ItemSpecialist,
  SpecialistContext,
  SpecialistOutput,
  SpecialistValidationError,
} from './specialist.types';
import {
  asArray,
  asRecord,
  asText,
  assertNoProblems,
  assertTrackItemContent,
  briefForPrompt,
  clampInt,
  collectContentIds,
  countWords,
  courseOutlineForPrompt,
  describeItemForPrompt,
  htmlToText,
  IdMinter,
  isRecord,
  itemForPrompt,
  nextPracticeInSection,
  objectivesForPrompt,
  plural,
  resolveCorrectOptions,
  SPECIALIST_MAX_TOKENS,
} from './specialist.util';

/** Inline checks when the blueprint does not say. Light: it is reading, not a quiz. */
const DEFAULT_ARTICLE_QUESTIONS = 2;
/** Below this the "article" is a stub; above it, it is several articles. */
const ARTICLE_MIN_WORDS = 150;
const ARTICLE_MAX_WORDS = 2_000;
const IMAGE_BRIEF_MAX_CHARS = 300;

const MARKER_ATTR = 'data-ally-question';
const TOKEN_PATTERN = /\[\[ALLY-Q:([^\]\s]+)\]\]/g;
const RAW_MARKER_PATTERN =
  /<div\b[^>]*\bdata-ally-question\s*=\s*["']([^"']+)["'][^>]*?(?:\/>|>(?:[^<]*<\/div>)?)/gi;
/** Block containers a question placeholder must never sit inside. */
const BLOCK_TAGS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote']);

const markerDiv = (id: string) => `<div ${MARKER_ATTR}="${id}"></div>`;

interface ArticleNormaliseOptions {
  title: string;
  questionCount: number;
  wantsImage: boolean;
  wordTarget: string;
  /** Ids a regeneration may keep (from the item's current content). */
  keepIds: ReadonlySet<string>;
  /** Text the trainer supplied; a resource link must appear in it. */
  allowedLinkText: string;
  /** Images the image job already put in this article, by src. */
  previousImages: Map<string, string>;
  fallbackImageBrief: string;
  /** True on the repair pass: drop what is still broken instead of failing. */
  lenient?: boolean;
}

/**
 * Writes one ARTICLE item: the supportive information a learner reads before
 * the practice that needs it.
 *
 * Stacks: "Working Memory Constraints in Content Chunking" — one chunk built
 * around at most 5–7 key points, 600–900 words for beginners and up to 1,200
 * for experienced audiences, inline checks optional (≤
 * COURSE_COPILOT_LIMITS.articleQuestions). "Four interrelated components of
 * training blueprints" — the article is supportive information, so the prompt
 * is told what practice comes next and writes towards it. "Forced-Choice
 * Questions Provide Cues and Reveal Misconceptions" — inline check distractors
 * are this audience's real mistakes.
 *
 * Two decisions made here, in code rather than the prompt:
 * - Resources keep only links the trainer supplied (the brief, or a
 *   regeneration's instructions). A model asked for "further reading" invents
 *   plausible URLs, and a dead link in a course reads as carelessness.
 * - Question placeholders are lifted out of paragraphs to top level, as the
 *   learner player expects (`articleSegments.ts` lifts nested ones too), and
 *   a question the model never placed is anchored at the end rather than lost.
 */
@Injectable()
export class ArticleSpecialist implements ItemSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(context: SpecialistContext): Promise<SpecialistOutput> {
    const { brief, blueprint, item, previous } = context;
    const spec = item.spec ?? {};
    const questionCount = clampInt(
      spec.questionCount,
      0,
      COURSE_COPILOT_LIMITS.articleQuestions,
      DEFAULT_ARTICLE_QUESTIONS,
    );
    const wantsImage = articleWantsImage(item, brief);
    const wordTarget =
      spec.wordTarget !== undefined
        ? `about ${clampInt(spec.wordTarget, 300, 1_500, 750)}`
        : '600-900 (up to 1,200 when the brief describes experienced practitioners)';
    const next = nextPracticeInSection(blueprint, item.id);

    const { data } = await this.llm.runJson({
      specialist: 'article',
      promptCode: COURSE_COPILOT_PROMPTS.ARTICLE_WRITER,
      taskId: COURSE_COPILOT_AI_TASKS.ARTICLE,
      task: LlmTask.COURSE_COPILOT_ARTICLE,
      maxTokens: SPECIALIST_MAX_TOKENS.ARTICLE,
      usageMetadata: context.usageMetadata,
      repairErrors: context.repairErrors,
      previous,
      variables: {
        brief_json: briefForPrompt(brief),
        course_outline: courseOutlineForPrompt(blueprint, item.id),
        item_json: itemForPrompt(item),
        objectives: objectivesForPrompt(brief, item),
        next_practice: next
          ? describeItemForPrompt(next)
          : 'Nothing practical follows in this section — the article closes it.',
        word_target: wordTarget,
        question_count: String(questionCount),
        image_instruction: wantsImage
          ? 'Also write "imageBrief": one sentence describing a calm, documentary-style photograph to sit beside this article — a real setting, objects, or people seen from behind or at a distance. No text in the image, no identifiable real people, nothing distressing.'
          : 'Set "imageBrief" to null — this article has no image.',
      },
    });

    return normaliseArticleOutput(data, {
      title: item.title,
      questionCount,
      wantsImage,
      wordTarget,
      keepIds: previous ? collectContentIds(previous.content) : new Set(),
      allowedLinkText: [
        JSON.stringify(brief ?? {}),
        previous ? JSON.stringify(previous.content ?? {}) : '',
        previous?.instructions ?? '',
      ].join('\n'),
      previousImages: previous
        ? extractImages(previous.content)
        : new Map<string, string>(),
      fallbackImageBrief: item.purpose || item.title,
      lenient: Boolean(context.repairErrors?.length),
    });
  }
}

/** Pure: raw model JSON → validated ARTICLE content. Exported for tests. */
export function normaliseArticleOutput(
  raw: Record<string, any>,
  opts: ArticleNormaliseOptions,
): SpecialistOutput {
  const root = isRecord(raw.article) ? raw.article : raw;
  const rawHtml = asText(root.html ?? root.body);
  if (!rawHtml) {
    throw new SpecialistValidationError([
      'The article has no body — "html" was empty.',
    ]);
  }

  const ids = new IdMinter(opts.keepIds);
  const problems: string[] = [];

  // ── Questions ───────────────────────────────────────────────────────────
  const questions: ArticleQuestion[] = [];
  /** Model id → the new ids minted for it, in order (models repeat "q1"). */
  const idQueue = new Map<string, string[]>();
  asArray(root.questions)
    .filter(isRecord)
    .slice(0, opts.questionCount)
    .forEach((rawQuestion, index) => {
      const result = normaliseInlineQuestion(rawQuestion, index, ids);
      if (typeof result === 'string') {
        // On the repair pass a still-broken inline check is dropped rather
        // than failing the whole article: the checks are optional, the prose
        // is what the learner came for.
        if (!opts.lenient) problems.push(result);
        return;
      }
      questions.push(result);
      const rawId = asText(rawQuestion.id);
      if (rawId) {
        idQueue.set(rawId, [...(idQueue.get(rawId) ?? []), result.id]);
      }
    });
  assertNoProblems(problems);

  // ── Html: placeholders → tokens, sanitise, tokens → top-level markers ──
  const withTokens = rawHtml.replace(RAW_MARKER_PATTERN, (_match, rawId) => {
    const queue = idQueue.get(String(rawId).trim());
    const id = queue?.shift();
    return id ? `[[ALLY-Q:${id}]]` : '';
  });
  const sanitised = sanitiseArticleHtml(withTokens, opts.previousImages);
  const kept = new Set(questions.map((question) => question.id));
  let html = liftQuestionMarkers(sanitised, kept);

  const placed = new Set(parseMarkers(html));
  const unplaced = questions.filter((question) => !placed.has(question.id));
  if (unplaced.length) {
    html += unplaced.map((question) => markerDiv(question.id)).join('');
  }
  html = restoreMissingImages(html, opts.previousImages);
  html = html.replace(/<p>(\s|<br\s*\/?>)*<\/p>/gi, '').trim();

  const words = countWords(htmlToText(html));
  if (words < ARTICLE_MIN_WORDS) {
    problems.push(
      `The article body is only ${words} words. Write the full article — ${opts.wordTarget} words.`,
    );
  }
  if (words > ARTICLE_MAX_WORDS) {
    problems.push(
      `The article is ${words} words, far past its target of ${opts.wordTarget}. Cut it back to the key points.`,
    );
  }
  assertNoProblems(problems);

  // ── Resources ───────────────────────────────────────────────────────────
  const resources: ArticleResource[] = [];
  for (const rawResource of asArray(root.resources).filter(isRecord)) {
    if (resources.length >= TRACK_MAX_ARTICLE_RESOURCES) break;
    const url = asText(rawResource.url);
    const title = asText(rawResource.title, 200);
    if (!title || !isHttpUrl(url)) continue;
    if (!opts.allowedLinkText.includes(url)) continue;
    resources.push({ id: ids.mint(rawResource.id), title, url });
  }

  const imageUrls = Array.from(extractImages({ html }).keys());
  const content: ArticleContent = {
    html,
    ...(imageUrls.length ? { imageUrls } : {}),
    ...(questions.length ? { questions } : {}),
    ...(resources.length ? { resources } : {}),
  };
  assertTrackItemContent(TrackItemType.ARTICLE, content, opts.title);

  const output: SpecialistOutput = {
    content: content as unknown as Record<string, any>,
    summary:
      `${words} words` +
      (questions.length ? ` · ${plural(questions.length, 'check')}` : ''),
  };
  if (opts.wantsImage) {
    output.imageBrief =
      asText(root.imageBrief, IMAGE_BRIEF_MAX_CHARS) ||
      asText(opts.fallbackImageBrief, IMAGE_BRIEF_MAX_CHARS);
  }
  return output;
}

/** A single-answer check, or the reason it cannot be one. */
function normaliseInlineQuestion(
  raw: Record<string, any>,
  index: number,
  ids: IdMinter,
): ArticleQuestion | string {
  const label = `Inline question ${index + 1}`;
  const prompt = asText(raw.prompt ?? raw.question);
  if (!prompt) return `${label} has no prompt.`;

  const optionIdMap = new Map<string, string>();
  const options = asArray(raw.options)
    .map((rawOption) => {
      const option = isRecord(rawOption) ? rawOption : { text: rawOption };
      const text = asText(option.text ?? option.label);
      if (!text) return null;
      const id = ids.mint(option.id);
      const rawId = asText(option.id);
      if (rawId && !optionIdMap.has(rawId)) optionIdMap.set(rawId, id);
      return { id, text };
    })
    .filter((option): option is { id: string; text: string } => !!option);
  if (options.length < 2) return `${label} needs at least two options.`;

  const correct = resolveCorrectOptions(raw, options, optionIdMap);
  if (correct.length !== 1) {
    return `${label} ("${prompt.slice(0, 60)}") must have exactly one correct option, given in correctOptionIds.`;
  }

  const question: ArticleQuestion = {
    id: ids.mint(raw.id),
    type: QuizQuestionType.MCQ_SINGLE,
    prompt,
    options,
    correctOptionIds: [correct[0]],
  };
  const explanation = asText(raw.explanation);
  if (explanation) question.explanation = explanation;
  return question;
}

function sanitiseArticleHtml(
  html: string,
  previousImages: Map<string, string>,
): string {
  const allowImages = previousImages.size > 0;
  return sanitizeHtml(html, {
    allowedTags: [
      'h2',
      'h3',
      'p',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      'blockquote',
      'a',
      'br',
      // Never generated: only an illustration the image job already placed,
      // carried through a regeneration (filtered to known srcs below).
      ...(allowImages ? ['img'] : []),
    ],
    allowedAttributes: {
      a: ['href'],
      ...(allowImages ? { img: ['src', 'alt'] } : {}),
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      h1: 'h2',
      h4: 'h3',
      h5: 'h3',
      h6: 'h3',
      b: 'strong',
      i: 'em',
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !previousImages.has(frame.attribs?.src ?? ''),
  });
}

/**
 * Turn placeholder tokens into `<div data-ally-question>` markers at the top
 * level. A token found inside a paragraph, list or quote is emitted right
 * after that block closes — never inside it.
 */
function liftQuestionMarkers(html: string, kept: ReadonlySet<string>): string {
  const out: string[] = [];
  const pending: string[] = [];
  const emitted = new Set<string>();
  let depth = 0;

  const emit = (id: string) => {
    if (!kept.has(id) || emitted.has(id)) return;
    emitted.add(id);
    out.push(markerDiv(id));
  };

  for (const part of html.split(/(<[^>]+>)/)) {
    if (part.startsWith('<')) {
      out.push(part);
      const tag = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(part);
      const name = tag?.[2]?.toLowerCase();
      if (name && BLOCK_TAGS.has(name)) {
        depth = Math.max(0, depth + (tag?.[1] ? -1 : 1));
        if (depth === 0 && tag?.[1]) pending.splice(0).forEach(emit);
      }
      continue;
    }
    let cursor = 0;
    for (const match of part.matchAll(TOKEN_PATTERN)) {
      out.push(part.slice(cursor, match.index));
      cursor = (match.index ?? 0) + match[0].length;
      if (depth === 0) emit(match[1]);
      else pending.push(match[1]);
    }
    out.push(part.slice(cursor));
  }
  pending.splice(0).forEach(emit);
  return out.join('').trim();
}

function parseMarkers(html: string): string[] {
  const pattern = new RegExp(`${MARKER_ATTR}="([^"]+)"`, 'g');
  return Array.from(html.matchAll(pattern), (match) => match[1]);
}

/** img src → alt, from an article's html and imageUrls. */
function extractImages(content: Record<string, any>): Map<string, string> {
  const images = new Map<string, string>();
  const html = typeof content?.html === 'string' ? content.html : '';
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1] ?? '';
    if (src) images.set(src, alt);
  }
  for (const url of asArray(asRecord(content).imageUrls)) {
    if (typeof url === 'string' && url && !images.has(url)) images.set(url, '');
  }
  return images;
}

/** A regeneration must not drop an illustration already paid for. */
function restoreMissingImages(
  html: string,
  previousImages: Map<string, string>,
): string {
  if (!previousImages.size) return html;
  const present = extractImages({ html });
  const missing = Array.from(previousImages.entries()).filter(
    ([src]) => !present.has(src),
  );
  if (!missing.length) return html;
  const tags = missing
    .map(
      ([src, alt]) =>
        `<p><img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" /></p>`,
    )
    .join('');
  return tags + html;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
