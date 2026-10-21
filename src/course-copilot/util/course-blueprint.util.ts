import { validate as isUuid, v4 as uuidv4 } from 'uuid';
import {
  TRACK_DEFAULT_ANNOTATION_PASS_SCORE,
  TRACK_DEFAULT_QUIZ_PASS_SCORE,
  TRACK_DEFAULT_VIDEO_WATCH_PCT,
  TRACK_MAX_COMPETENCIES,
} from 'src/track/constants/track.constant';
import { TrackGameKey } from 'src/track/type/game.type';
import { TrackItemType, VideoSource } from 'src/track/type/track.type';
import {
  COURSE_COPILOT_DEFAULT_ITEM_MINUTES,
  COURSE_COPILOT_LIMITS,
} from '../constants/course-copilot.constants';
import {
  CourseBlueprint,
  CourseBlueprintCompletionCriteria,
  CourseBlueprintItem,
  CourseBlueprintItemSource,
  CourseBlueprintSection,
  CourseBrief,
  CourseBriefVideo,
} from '../type/course-copilot.type';

/**
 * Pure helpers over the course blueprint: turning whatever the planner model
 * returned into a well-formed `CourseBlueprint`, and listing what blocks the
 * trainer from approving it.
 *
 * Nothing here calls a model or a repository, so the same functions serve the
 * planner's output, the trainer's edits from the tree (`PUT …/blueprint`) and
 * the chat's `update_blueprint` patches.
 */

/** Used when neither the item, the practice slot nor the brief names one. */
export const COURSE_COPILOT_DEFAULT_ROLEPLAY_MIN_SCORE = 60;

/** Learner-facing type names, for problems a trainer reads. */
export const COURSE_BLUEPRINT_ITEM_TYPE_LABELS: Record<TrackItemType, string> =
  {
    [TrackItemType.ROLEPLAY]: 'Roleplay',
    [TrackItemType.CASE]: 'Case',
    [TrackItemType.QUIZ]: 'Quiz',
    [TrackItemType.ARTICLE]: 'Article',
    [TrackItemType.VIDEO]: 'Video',
    [TrackItemType.JOURNAL]: 'Journal',
    [TrackItemType.ANNOTATED_ARTIFACT]: 'Annotated transcript',
    [TrackItemType.GAME]: 'Game',
    [TrackItemType.BRANCHING_SCENARIO]: 'Branching scenario',
    [TrackItemType.BUCKET_SORT]: 'Bucket sort',
  };

/**
 * The games the planner may place, one line each. Wording is the admin
 * editor's own game picker (ally-web `TRACK_GAME_CATALOG` in
 * `constants/CreateTrack.ts`), so the copilot describes a game the way the
 * trainer will later see it described. Keep the two in step when a game is
 * added; `TrackGameKey` is the source of truth for which keys exist.
 */
export const COURSE_COPILOT_GAME_CATALOG: ReadonlyArray<{
  key: TrackGameKey;
  name: string;
  description: string;
}> = [
  {
    key: TrackGameKey.TREX_RUNNER,
    name: 'T-Rex Runner',
    description:
      'The offline dinosaur game. Press space or tap to jump the cactus. Nothing to learn, which is the point — it is a breather. Under a minute a run.',
  },
  {
    key: TrackGameKey.TIC_TAC_TOE,
    name: 'Tic-Tac-Toe',
    description:
      'Nine squares against the computer. Starts on Easy so it is winnable, with a Hard toggle. About half a minute a game.',
  },
  {
    key: TrackGameKey.MEMORY_MATCH,
    name: 'Memory Match',
    description:
      'Sixteen cards face down, eight pairs to find. Quiet and unhurried — the one to reach for after a heavy roleplay rather than before one. A minute or two a round.',
  },
  {
    key: TrackGameKey.CUB_N_PUP,
    name: 'Cub n Pup',
    description:
      'A peg-and-link puzzle that starts as a tutorial and ends genuinely hard — the thinking one, so put it where a learner has room to stop when they want to.',
  },
  {
    key: TrackGameKey.SNAKE,
    name: 'Snake',
    description:
      'Steer a growing line to the food without running into your own tail; the walls wrap, so it is the forgiving one. A minute or two a run.',
  },
  {
    key: TrackGameKey.SPROUT,
    name: 'Sprout',
    description:
      'Water a plant and grow it to bloom; the soil has a sweet spot and the plant cannot die. The gentlest one here, about a minute and a half.',
  },
  {
    key: TrackGameKey.BREATHING_EXERCISE,
    name: 'Breathing Exercise',
    description:
      'A guided box-breathing exercise to help learners regulate. You can configure the timing for each step (inhale, hold, exhale, hold) and the total number of cycles.',
  },
];

/** `BlueprintPlannerInput.games`, ready to pass. */
export function courseCopilotGameOptions(): {
  key: string;
  description: string;
}[] {
  return COURSE_COPILOT_GAME_CATALOG.map((game) => ({
    key: game.key,
    description: `${game.name} — ${game.description}`,
  }));
}

const GAME_KEYS = new Set<string>(Object.values(TrackGameKey));
const ITEM_TYPES = new Set<string>(Object.values(TrackItemType));
const TYPE_ALIASES: Record<string, TrackItemType> = {
  ROLE_PLAY: TrackItemType.ROLEPLAY,
  SIMULATION: TrackItemType.ROLEPLAY,
  ANNOTATION: TrackItemType.ANNOTATED_ARTIFACT,
  ANNOTATED_TRANSCRIPT: TrackItemType.ANNOTATED_ARTIFACT,
  TRANSCRIPT: TrackItemType.ANNOTATED_ARTIFACT,
  READING: TrackItemType.ARTICLE,
  REFLECTION: TrackItemType.JOURNAL,
};

// ── Small coercions (kept local: this file must stay importable on its own) ──

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function score(value: unknown): number | undefined {
  const parsed = num(value);
  if (parsed === undefined) return undefined;
  return Math.min(100, Math.max(0, Math.round(parsed)));
}

function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function toItemType(raw: unknown): TrackItemType | null {
  const key = text(raw)
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (ITEM_TYPES.has(key)) return key as TrackItemType;
  return TYPE_ALIASES[key] ?? null;
}

function videoSourceFor(url: string, declared?: unknown): VideoSource {
  const sources = Object.values(VideoSource) as string[];
  const given = text(declared).toLowerCase();
  if (sources.includes(given)) return given as VideoSource;
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (host.includes('youtube.') || host === 'youtu.be')
    return VideoSource.YOUTUBE;
  if (host.includes('vimeo.')) return VideoSource.VIMEO;
  if (host.includes('loom.')) return VideoSource.LOOM;
  return VideoSource.S3;
}

/** Whether an article gets a generated illustration. Item-level choice wins. */
export function articleWantsImage(
  item: Pick<CourseBlueprintItem, 'type' | 'spec'>,
  brief: CourseBrief,
): boolean {
  if (item.type !== TrackItemType.ARTICLE) return false;
  const withImage = item.spec?.withImage;
  if (withImage === true) return true;
  if (withImage === false) return false;
  return brief?.look?.articleImages === 'one-per-article';
}

/** Mints blueprint ids: keeps a caller's uuid, replaces anything else. */
class BlueprintIdMinter {
  private readonly used = new Set<string>();

  mint(raw: unknown): string {
    const candidate = text(raw);
    if (candidate && isUuid(candidate) && !this.used.has(candidate)) {
      this.used.add(candidate);
      return candidate;
    }
    let id = uuidv4();
    while (this.used.has(id)) id = uuidv4();
    this.used.add(id);
    return id;
  }
}

// ── normaliseBlueprint ──────────────────────────────────────────────────────

/**
 * Turn the planner's raw JSON (or a trainer-edited blueprint) into a
 * well-formed `CourseBlueprint`.
 *
 * Repairs only what has one right answer — ids, types, defaults, totals,
 * matching a video to the trainer's link. Anything that needs a decision
 * (a case with one roleplay, a course that ends on a game, too many new
 * roleplays) is left as it is for `validateBlueprint` to put in front of the
 * trainer, so a hand-edited tree is never silently rewritten.
 *
 * Ids: a uuid the caller already chose is kept (blueprint ids are stable across
 * patches and key every build job); a missing, duplicate or model-minted one
 * ("i3") becomes a fresh uuid, and `spec.memberItemIds` is rewritten to match.
 */
export function normaliseBlueprint(
  raw: unknown,
  brief: CourseBrief,
): CourseBlueprint {
  const root = unwrap(raw);
  const ids = new BlueprintIdMinter();
  const itemIdMap = new Map<string, string>();
  const enablingCount = brief?.outcomes?.enabling?.length ?? 0;
  const assignedVideoUrls = new Set<string>();

  const sections: CourseBlueprintSection[] = asArray(root.sections)
    .filter(isRecord)
    .map((rawSection) => {
      const items: CourseBlueprintItem[] = [];
      for (const rawItem of asArray(rawSection.items).filter(isRecord)) {
        const item = normaliseItem(rawItem, {
          brief,
          ids,
          enablingCount,
          assignedVideoUrls,
        });
        if (!item) continue;
        const rawId = text(rawItem.id);
        if (rawId && !itemIdMap.has(rawId)) itemIdMap.set(rawId, item.id);
        items.push(item);
      }
      return {
        id: ids.mint(rawSection.id),
        title: text(rawSection.title),
        description: text(rawSection.description),
        purpose: text(rawSection.purpose),
        items,
      };
    });

  const allItems = sections.flatMap((section) => section.items);

  // A new case names its member roleplays by the ids the model minted; follow
  // them to the ids those items now carry.
  for (const item of allItems) {
    if (item.type !== TrackItemType.CASE) continue;
    if (!Array.isArray(item.spec.memberItemIds)) continue;
    item.spec.memberItemIds = Array.from(
      new Set(
        item.spec.memberItemIds
          .map((id: unknown) => text(id))
          .filter(Boolean)
          .map((id: string) => itemIdMap.get(id) ?? id),
      ),
    );
  }

  assignUnmatchedVideo(allItems, brief, assignedVideoUrls);
  applyCompletionDefaults(allItems, brief);

  const minutes = allItems.reduce(
    (sum, item) => sum + (item.estimatedMinutes || 0),
    0,
  );
  const rawCover = isRecord(root.cover) ? root.cover : {};
  const coverMode =
    brief?.look?.cover ??
    (['generate', 'library', 'upload-later'].includes(text(rawCover.mode))
      ? (text(rawCover.mode) as CourseBlueprint['cover']['mode'])
      : 'generate');
  const cover: CourseBlueprint['cover'] = { mode: coverMode };
  if (text(rawCover.prompt)) cover.prompt = text(rawCover.prompt);
  const coverImageUrl = brief?.look?.coverImageUrl || text(rawCover.imageUrl);
  if (coverImageUrl && coverMode === 'library') cover.imageUrl = coverImageUrl;

  const blueprint: CourseBlueprint = {
    title: text(root.title),
    description: text(root.description),
    estimatedDurationMinutes: minutes,
    competencyIds: (brief?.competencyIds ?? [])
      .filter((id) => typeof id === 'string' && id.trim())
      .slice(0, TRACK_MAX_COMPETENCIES),
    cover,
    sections,
    estimate: {
      usd: 0,
      minutes,
      items: allItems.length,
      newRoleplays: 0,
      images: 0,
    },
  };
  blueprint.estimate.newRoleplays = countNewRoleplays(blueprint);
  blueprint.estimate.images = countImages(blueprint, brief);
  return blueprint;
}

function unwrap(raw: unknown): Record<string, any> {
  if (!isRecord(raw)) return {};
  if (isRecord(raw.blueprint)) return raw.blueprint;
  return raw;
}

interface ItemNormaliseContext {
  brief: CourseBrief;
  ids: BlueprintIdMinter;
  enablingCount: number;
  assignedVideoUrls: Set<string>;
}

function normaliseItem(
  raw: Record<string, any>,
  context: ItemNormaliseContext,
): CourseBlueprintItem | null {
  const type = toItemType(raw.type);
  if (!type) return null;

  const spec: Record<string, any> = isRecord(raw.spec) ? { ...raw.spec } : {};
  const objectiveRefs = Array.from(
    new Set(
      asArray(raw.objectiveRefs)
        .map((ref) => num(ref))
        .filter(
          (ref): ref is number =>
            ref !== undefined &&
            Number.isInteger(ref) &&
            ref >= 0 &&
            ref < context.enablingCount,
        ),
    ),
  );

  if (type === TrackItemType.GAME) {
    const key = text(spec.gameKey).toUpperCase();
    spec.gameKey = GAME_KEYS.has(key) ? key : TrackGameKey.TREX_RUNNER;
  }

  const source =
    type === TrackItemType.VIDEO
      ? resolveVideo(spec, text(raw.title), context)
      : normaliseSource(type, raw.source, spec);

  const item: CourseBlueprintItem = {
    id: context.ids.mint(raw.id),
    type,
    title: text(raw.title),
    purpose: text(raw.purpose),
    objectiveRefs,
    estimatedMinutes: estimateMinutes(type, raw.estimatedMinutes, spec),
    source,
    spec,
  };
  const criteria = isRecord(raw.completionCriteria)
    ? raw.completionCriteria
    : undefined;
  if (criteria) item.completionCriteria = { ...criteria };
  if (typeof raw.hasDiscussion === 'boolean') {
    item.hasDiscussion = raw.hasDiscussion;
  }
  return item;
}

function normaliseSource(
  type: TrackItemType,
  raw: unknown,
  spec: Record<string, any>,
): CourseBlueprintItemSource {
  const source = isRecord(raw) ? raw : {};
  const kind = text(source.kind).toLowerCase();

  if (type === TrackItemType.ROLEPLAY || type === TrackItemType.CASE) {
    const scenarioId = num(source.scenarioId ?? spec.scenarioId);
    const caseId = text(source.caseId ?? spec.caseId);
    const fromLibrary =
      kind === 'library' ||
      (kind !== 'new' &&
        (type === TrackItemType.ROLEPLAY
          ? scenarioId !== undefined
          : !!caseId));
    if (!fromLibrary) return { kind: 'new' };
    if (type === TrackItemType.ROLEPLAY) {
      return scenarioId !== undefined && Number.isInteger(scenarioId)
        ? { kind: 'library', scenarioId }
        : { kind: 'library' };
    }
    return caseId ? { kind: 'library', caseId } : { kind: 'library' };
  }

  // Inline types are always written fresh — unless the planner started from a
  // Component Library template, which is the one library source they have.
  const templateId = text(source.templateId ?? spec.templateId);
  if (kind === 'library' && templateId) return { kind: 'library', templateId };
  return { kind: 'new' };
}

/**
 * A video needs a link the trainer gave us — the copilot cannot make one.
 * Keep a valid `spec.url`; otherwise match the item to `brief.videoUrls` by
 * index or by title. With no match it is `needs-input`, and the build skips it
 * with a note (plan §1.4) rather than failing.
 */
function resolveVideo(
  spec: Record<string, any>,
  title: string,
  context: ItemNormaliseContext,
): CourseBlueprintItemSource {
  const videos = context.brief?.videoUrls ?? [];
  if (isHttpUrl(spec.url)) {
    const url = spec.url.trim();
    const known = videos.find((video) => video.url === url);
    fillVideoSpec(spec, known ?? { url });
    context.assignedVideoUrls.add(url);
    return { kind: 'new' };
  }

  const unassigned = videos.filter(
    (video) =>
      isHttpUrl(video.url) && !context.assignedVideoUrls.has(video.url),
  );
  const index = num(spec.videoIndex);
  let match: CourseBriefVideo | undefined =
    index !== undefined && Number.isInteger(index) ? videos[index] : undefined;
  if (match && context.assignedVideoUrls.has(match.url)) match = undefined;
  if (!match && title) {
    const wanted = fold(title);
    match = unassigned.find((video) => {
      const candidate = fold(video.title ?? '');
      return (
        !!candidate &&
        (candidate === wanted ||
          candidate.includes(wanted) ||
          wanted.includes(candidate))
      );
    });
  }
  if (match && isHttpUrl(match.url)) {
    fillVideoSpec(spec, match);
    context.assignedVideoUrls.add(match.url);
    return { kind: 'new' };
  }
  return { kind: 'needs-input', what: 'video-url' };
}

function fillVideoSpec(
  spec: Record<string, any>,
  video: Partial<CourseBriefVideo> & { url: string },
): void {
  spec.url = video.url.trim();
  spec.source = videoSourceFor(spec.url, spec.source ?? video.source);
  const duration = num(spec.durationSeconds) ?? num(video.durationSeconds);
  if (duration !== undefined && duration > 0) {
    spec.durationSeconds = Math.round(duration);
  }
  delete spec.videoIndex;
}

/**
 * The one guess worth making after the first pass: a brief with exactly one
 * unused video and exactly one video item still waiting for a link.
 */
function assignUnmatchedVideo(
  items: CourseBlueprintItem[],
  brief: CourseBrief,
  assigned: Set<string>,
): void {
  const waiting = items.filter(
    (item) =>
      item.type === TrackItemType.VIDEO && item.source.kind === 'needs-input',
  );
  const unused = (brief?.videoUrls ?? []).filter(
    (video) => isHttpUrl(video.url) && !assigned.has(video.url),
  );
  if (waiting.length !== 1 || unused.length !== 1) return;
  const [item] = waiting;
  fillVideoSpec(item.spec, unused[0]);
  item.source = { kind: 'new' };
  item.estimatedMinutes = estimateMinutes(
    item.type as TrackItemType,
    undefined,
    item.spec,
  );
  assigned.add(unused[0].url);
}

function estimateMinutes(
  type: TrackItemType,
  raw: unknown,
  spec: Record<string, any>,
): number {
  const fallback = COURSE_COPILOT_DEFAULT_ITEM_MINUTES[type] ?? 5;
  // A video's own length beats anyone's guess at it.
  if (type === TrackItemType.VIDEO) {
    const seconds = num(spec.durationSeconds);
    if (seconds !== undefined && seconds > 0) {
      return Math.max(1, Math.ceil(seconds / 60));
    }
  }
  const minutes = num(raw);
  if (minutes === undefined || minutes <= 0) return fallback;
  return Math.min(240, Math.max(1, Math.round(minutes)));
}

/**
 * Fill each item's completion rule and drop keys its type never reads.
 *
 * Roleplay minScore: the item's own, then its spec, then its brief practice
 * slot, then — for the capstone, when the brief's assessment is a roleplay —
 * the assessment threshold, then 60. 0 is a real value ("no gate"), so every
 * fallback is `??`, never `||`.
 */
function applyCompletionDefaults(
  items: CourseBlueprintItem[],
  brief: CourseBrief,
): void {
  const assessment = brief?.assessment;
  const threshold = score(assessment?.threshold);
  const capstoneType: Record<string, TrackItemType> = {
    roleplay: TrackItemType.ROLEPLAY,
    quiz: TrackItemType.QUIZ,
    annotated_artifact: TrackItemType.ANNOTATED_ARTIFACT,
  };
  const capstoneKind = assessment?.kind
    ? capstoneType[assessment.kind]
    : undefined;
  const capstone = capstoneKind
    ? [...items].reverse().find((item) => item.type === capstoneKind)
    : undefined;
  const capstoneThreshold = (item: CourseBlueprintItem) =>
    item === capstone ? threshold : undefined;

  for (const item of items) {
    const given = item.completionCriteria ?? {};
    let criteria: CourseBlueprintCompletionCriteria | undefined;
    switch (item.type) {
      case TrackItemType.ROLEPLAY: {
        const minDuration = num(given.minDurationSeconds);
        criteria = {
          minScore:
            score(given.minScore) ??
            score(item.spec.minScore) ??
            practiceSlotMinScore(item, brief) ??
            capstoneThreshold(item) ??
            COURSE_COPILOT_DEFAULT_ROLEPLAY_MIN_SCORE,
        };
        if (minDuration !== undefined && minDuration >= 0) {
          criteria.minDurationSeconds = Math.round(minDuration);
        }
        break;
      }
      case TrackItemType.CASE: {
        const minScore = score(given.minScore);
        criteria = minScore !== undefined ? { minScore } : undefined;
        break;
      }
      case TrackItemType.QUIZ:
        criteria = {
          passScore:
            score(given.passScore) ??
            capstoneThreshold(item) ??
            TRACK_DEFAULT_QUIZ_PASS_SCORE,
        };
        break;
      case TrackItemType.ANNOTATED_ARTIFACT:
        criteria = {
          passScore:
            score(given.passScore) ??
            capstoneThreshold(item) ??
            TRACK_DEFAULT_ANNOTATION_PASS_SCORE,
        };
        break;
      case TrackItemType.VIDEO:
        criteria = {
          watchPct: score(given.watchPct) ?? TRACK_DEFAULT_VIDEO_WATCH_PCT,
        };
        break;
      case TrackItemType.ARTICLE: {
        const seconds = num(given.minReadSeconds);
        criteria = {
          minReadSeconds:
            seconds !== undefined && seconds >= 0 ? Math.round(seconds) : 0,
        };
        break;
      }
      default:
        // JOURNAL has no rule; GAME never gates (see game.type.ts).
        criteria = undefined;
    }
    if (criteria) item.completionCriteria = criteria;
    else delete item.completionCriteria;
  }
}

function practiceSlotMinScore(
  item: CourseBlueprintItem,
  brief: CourseBrief,
): number | undefined {
  const practice = brief?.practice ?? [];
  const slotNumber = num(item.spec.slot ?? item.spec.practiceSlot);
  const scenarioId =
    item.source.kind === 'library' ? item.source.scenarioId : undefined;
  const slot =
    (slotNumber !== undefined
      ? practice.find((candidate) => candidate.slot === slotNumber)
      : undefined) ??
    (scenarioId !== undefined
      ? practice.find((candidate) => candidate.scenarioId === scenarioId)
      : undefined);
  return score(slot?.minScore);
}

// ── Counting ────────────────────────────────────────────────────────────────

function allItemsOf(blueprint: CourseBlueprint): CourseBlueprintItem[] {
  return (blueprint?.sections ?? []).flatMap((section) => section.items ?? []);
}

export function countNewRoleplays(blueprint: CourseBlueprint): number {
  return allItemsOf(blueprint).filter(
    (item) =>
      item.type === TrackItemType.ROLEPLAY && item.source?.kind === 'new',
  ).length;
}

export function countNewCases(blueprint: CourseBlueprint): number {
  return allItemsOf(blueprint).filter(
    (item) => item.type === TrackItemType.CASE && item.source?.kind === 'new',
  ).length;
}

/** Generated images: the cover (when generated) plus each illustrated article. */
export function countImages(
  blueprint: CourseBlueprint,
  brief: CourseBrief,
): number {
  const cover = blueprint?.cover?.mode === 'generate' ? 1 : 0;
  return (
    cover +
    allItemsOf(blueprint).filter((item) => articleWantsImage(item, brief))
      .length
  );
}

// ── Validation ──────────────────────────────────────────────────────────────

export interface ValidateBlueprintOptions {
  /** `config.courseCopilot.maxNewRoleplays`; COURSE_COPILOT_LIMITS.newRoleplays by default. */
  maxNewRoleplays: number;
}

/**
 * Problems that block approval, phrased for the trainer who has to fix them
 * in the tree or in chat — not for a developer. Empty means approvable.
 *
 * A video still waiting for its link is deliberately not here: it is skipped
 * at build time with a note (plan §1.4), so it is a warning — see
 * `blueprintWarnings`.
 */
export function validateBlueprint(
  blueprint: CourseBlueprint,
  brief: CourseBrief,
  opts: ValidateBlueprintOptions,
): string[] {
  const limits = COURSE_COPILOT_LIMITS;
  const problems: string[] = [];
  const sections = blueprint?.sections ?? [];
  const items = allItemsOf(blueprint);

  if (sections.length === 0) {
    problems.push('The course has no sections yet.');
  }
  if (sections.length > limits.sections) {
    problems.push(
      `The course has ${sections.length} sections; a course can have at most ${limits.sections}. Merge or remove some.`,
    );
  }
  if (items.length > limits.items) {
    problems.push(
      `The course has ${items.length} items; a course can have at most ${limits.items}. Remove some.`,
    );
  }

  const roleplayIds = new Set(
    items
      .filter((item) => item.type === TrackItemType.ROLEPLAY)
      .map((item) => item.id),
  );

  sections.forEach((section, sectionIndex) => {
    const sectionNumber = sectionIndex + 1;
    const sectionTitle = (section.title ?? '').trim();
    const sectionLabel = sectionTitle
      ? `Section ${sectionNumber} · '${sectionTitle}'`
      : `Section ${sectionNumber}`;
    const sectionItems = section.items ?? [];

    if (!sectionTitle) problems.push(`Section ${sectionNumber} needs a title.`);
    if (sectionItems.length === 0) {
      problems.push(
        `${sectionLabel} has no items. Add one or remove the section.`,
      );
    }
    if (sectionItems.length > limits.itemsPerSection) {
      problems.push(
        `${sectionLabel} has ${sectionItems.length} items; a section can hold at most ${limits.itemsPerSection}. Split it in two.`,
      );
    }

    sectionItems.forEach((item, itemIndex) => {
      const label = itemLabel(sectionNumber, itemIndex, item);
      if (!(item.title ?? '').trim()) problems.push(`${label} needs a title.`);
      const spec = item.spec ?? {};

      switch (item.type) {
        case TrackItemType.ROLEPLAY: {
          if (
            item.source?.kind === 'library' &&
            !Number.isInteger(item.source.scenarioId)
          ) {
            problems.push(
              `${label} is set to use a library roleplay but doesn't say which one. Pick one, or make it a new roleplay.`,
            );
          }
          const languages = Array.isArray(spec.languageIds)
            ? new Set(spec.languageIds.map((id: unknown) => String(id))).size
            : 0;
          if (languages > limits.languagesPerRoleplay) {
            problems.push(
              `${label} is set to ${languages} languages; a roleplay can use at most ${limits.languagesPerRoleplay}.`,
            );
          }
          break;
        }
        case TrackItemType.CASE: {
          if (item.source?.kind === 'library' && !item.source.caseId) {
            problems.push(
              `${label} is set to use a library case but doesn't say which one. Pick one, or build a new case from this course's roleplays.`,
            );
          }
          if (item.source?.kind === 'new') {
            const members = new Set(
              asArray(spec.memberItemIds).filter((id) =>
                roleplayIds.has(String(id)),
              ),
            ).size;
            if (members < 2) {
              problems.push(
                `${label} is a new case but links ${
                  members === 0 ? 'no roleplays' : 'only one roleplay'
                }; a case needs at least two roleplays from this course.`,
              );
            }
          }
          break;
        }
        case TrackItemType.GAME:
          if (!GAME_KEYS.has(String(spec.gameKey ?? ''))) {
            problems.push(`${label} uses a game that isn't available.`);
          }
          break;
        default:
          break;
      }
    });
  });

  const last = items[items.length - 1];
  if (last?.type === TrackItemType.GAME) {
    problems.push(
      `The course ends on a game${
        last.title ? ` ('${last.title}')` : ''
      }. Games are breaks between harder items — move it earlier or remove it.`,
    );
  }

  const newRoleplays = countNewRoleplays(blueprint);
  if (newRoleplays > opts.maxNewRoleplays) {
    problems.push(
      `The course would create ${newRoleplays} new roleplays; one course can create at most ${opts.maxNewRoleplays}. Use library roleplays for some of them, or remove one.`,
    );
  }
  const newCases = countNewCases(blueprint);
  if (newCases > limits.newCases) {
    problems.push(
      `The course would create ${newCases} new cases; one course can create at most ${limits.newCases}.`,
    );
  }
  const images = countImages(blueprint, brief);
  if (images > limits.images) {
    problems.push(
      `The course would generate ${images} images; one course can have at most ${limits.images}. Turn images off on some articles.`,
    );
  }

  return problems;
}

/**
 * Notes the trainer should see before approving that do not block it:
 * - a video still waiting for its link, which the build skips with a note
 *   (plan §1.4) rather than failing;
 * - a video the trainer supplied that no item uses — they gave it for a
 *   reason, so saying nothing would read as the copilot losing it.
 */
export function blueprintWarnings(
  blueprint: CourseBlueprint,
  brief: CourseBrief,
): string[] {
  const warnings: string[] = [];
  const usedUrls = new Set<string>();
  (blueprint?.sections ?? []).forEach((section, sectionIndex) => {
    (section.items ?? []).forEach((item, itemIndex) => {
      if (item.type !== TrackItemType.VIDEO) return;
      if (item.source?.kind !== 'needs-input' && isHttpUrl(item.spec?.url)) {
        usedUrls.add(item.spec.url.trim());
        return;
      }
      warnings.push(
        `${itemLabel(sectionIndex + 1, itemIndex, item)} needs a video link — it will be skipped until you add one in the editor.`,
      );
    });
  });
  for (const video of brief?.videoUrls ?? []) {
    if (!isHttpUrl(video.url) || usedUrls.has(video.url.trim())) continue;
    warnings.push(
      `The video ${
        video.title ? `'${video.title}'` : 'you supplied'
      } isn't used anywhere in the course yet.`,
    );
  }
  return warnings;
}

function itemLabel(
  sectionNumber: number,
  itemIndex: number,
  item: CourseBlueprintItem,
): string {
  const title = (item.title ?? '').trim();
  if (title) return `Section ${sectionNumber} · '${title}'`;
  const typeName =
    COURSE_BLUEPRINT_ITEM_TYPE_LABELS[item.type as TrackItemType] ?? item.type;
  return `Section ${sectionNumber} · item ${itemIndex + 1} (${typeName})`;
}
