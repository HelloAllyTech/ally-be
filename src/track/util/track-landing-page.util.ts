import { TRACK_ITEM_XP, XP_AWARD } from 'src/progress/progress.constants';
import { TrackItemType } from '../type/track.type';
import {
  LANDING_FIRST_MOVE_MIN_REPLIES,
  LandingChapter,
  LandingReply,
  LandingSittingLength,
  PublicTrackStory,
  StoryBeat,
  TRACK_LANDING_LIMITS,
  TrackLandingPage,
} from '../type/track-landing-page.type';

/* ---------------------------------------------------------------- *
 * Coercion
 * ---------------------------------------------------------------- */

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asList = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

/** Trimmed text, or null for anything that is not text or is blank. */
const asText = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

/**
 * Every block defaults to on. Only an explicit `false` switches one off, so a
 * half-filled draft, an older client, or `{}` never silently hides a block.
 */
const asEnabled = (value: unknown): boolean => value !== false;

const asEnum = <T extends string>(
  values: readonly T[],
  value: unknown,
): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value)
    ? (value as T)
    : null;

const STORY_BEATS = Object.values(StoryBeat);
const SITTING_LENGTHS = Object.values(LandingSittingLength);

/* ---------------------------------------------------------------- *
 * Normalise
 * ---------------------------------------------------------------- */

/**
 * Any landing-page input — a request body, a stored row, `null` — as the full
 * stored shape: every key present, strings trimmed, `""` → `null`, every
 * `enabled` defaulting to true.
 *
 * Lenient about what it is given and strict about what it returns, so the
 * stored value (and everything built from it) never has to ask "is this key
 * here?". Lengths are the DTO's job on the way in; this caps only the counts,
 * because a list past its limit has to lose items rather than be rejected when
 * it arrives from a stored row.
 */
export function normaliseTrackLandingPage(input: unknown): TrackLandingPage {
  const root = asRecord(input);
  const hero = asRecord(root.hero);
  const persona = asRecord(root.persona);
  const firstMove = asRecord(root.firstMove);
  const arc = asRecord(root.arc);
  const outcomes = asRecord(root.outcomes);
  const howItPlays = asRecord(root.howItPlays);
  const cast = asRecord(root.cast);
  const guide = asRecord(cast.guide);
  const xp = asRecord(root.xp);
  const contentNotes = asRecord(root.contentNotes);

  return {
    version: 1,
    hero: {
      hook: asText(hero.hook),
      question: asText(hero.question),
      courseLine: asText(hero.courseLine),
      buttonLabel: asText(hero.buttonLabel),
    },
    persona: {
      name: asText(persona.name),
      descriptor: asText(persona.descriptor),
      imageUrl: asText(persona.imageUrl),
      characterId: asText(persona.characterId),
    },
    firstMove: {
      enabled: asEnabled(firstMove.enabled),
      sceneLine: asText(firstMove.sceneLine),
      personaLine: asText(firstMove.personaLine),
      prompt: asText(firstMove.prompt),
      replies: normaliseReplies(firstMove.replies),
    },
    arc: {
      enabled: asEnabled(arc.enabled),
      chapters: normaliseChapters(arc.chapters),
      hardCallSectionId: asText(arc.hardCallSectionId),
    },
    outcomes: {
      enabled: asEnabled(outcomes.enabled),
      items: asList(outcomes.items)
        .map(asText)
        .filter((item): item is string => item !== null)
        .slice(0, TRACK_LANDING_LIMITS.outcomes),
    },
    howItPlays: {
      enabled: asEnabled(howItPlays.enabled),
      sittingLength: asEnum(SITTING_LENGTHS, howItPlays.sittingLength),
    },
    cast: {
      enabled: asEnabled(cast.enabled),
      callerLine: asText(cast.callerLine),
      guide: {
        name: asText(guide.name),
        role: asText(guide.role),
        line: asText(guide.line),
      },
    },
    xp: { enabled: asEnabled(xp.enabled) },
    contentNotes: { extraNote: asText(contentNotes.extraNote) },
  };
}

/**
 * A reply with no text is nothing to show, so it is dropped. One with text but
 * no label is kept (label `''`): an author mid-edit has not lost it, and the
 * public builder is what refuses to show it.
 */
function normaliseReplies(value: unknown): LandingReply[] {
  const replies: LandingReply[] = [];
  for (const raw of asList(value)) {
    const reply = asRecord(raw);
    const text = asText(reply.text);
    if (text === null) continue;
    replies.push({
      text,
      label: asText(reply.label) ?? '',
      why: asText(reply.why),
    });
  }
  return replies.slice(0, TRACK_LANDING_LIMITS.replies);
}

/** One chapter per section; if a section appears twice, the last entry wins. */
function normaliseChapters(value: unknown): LandingChapter[] {
  const bySection = new Map<string, LandingChapter>();
  for (const raw of asList(value)) {
    const chapter = asRecord(raw);
    const sectionId = asText(chapter.sectionId);
    if (sectionId === null) continue;
    bySection.delete(sectionId);
    bySection.set(sectionId, {
      sectionId,
      beat: asEnum(STORY_BEATS, chapter.beat),
      teaser: asText(chapter.teaser),
    });
  }
  return [...bySection.values()].slice(0, TRACK_LANDING_LIMITS.chapters);
}

/* ---------------------------------------------------------------- *
 * Duplicate
 * ---------------------------------------------------------------- */

/**
 * The page re-pointed at a copy's sections, for `duplicateTrack`.
 *
 * A chapter whose section has no mapping is dropped and an unmapped hard call
 * becomes null: a copy must never carry an id that belongs to the original
 * course, because that id would then read as "a section that no longer exists"
 * and be ignored — or, worse, be matched by a later edit of the original.
 */
export function remapLandingPageSections(
  page: TrackLandingPage | null | undefined,
  oldToNew: ReadonlyMap<string, string>,
): TrackLandingPage | null {
  if (!page) return null;
  const copy = normaliseTrackLandingPage(page);
  return {
    ...copy,
    arc: {
      ...copy.arc,
      chapters: copy.arc.chapters.flatMap((chapter) => {
        const sectionId = oldToNew.get(chapter.sectionId);
        return sectionId ? [{ ...chapter, sectionId }] : [];
      }),
      hardCallSectionId: copy.arc.hardCallSectionId
        ? (oldToNew.get(copy.arc.hardCallSectionId) ?? null)
        : null,
    },
  };
}

/* ---------------------------------------------------------------- *
 * Public story
 * ---------------------------------------------------------------- */

/** A section as the public outline lists it: id and the types of its items. */
export interface PublicStorySection {
  id: string;
  items: { type: TrackItemType }[];
}

/** Trigger-warning names per section id (duplicates and blanks tolerated). */
export type StoryWarningsBySection = ReadonlyMap<string, readonly string[]>;

/**
 * The public `story` payload for a course, or null when it is not in story
 * mode. This is the one place the display rules live (contract §1): a block is
 * returned only when it is enabled AND has the content it needs, so a disabled
 * or half-written draft never leaves the server.
 *
 * Pure: the caller loads the sections and the warnings. Section ids in the
 * config that no longer exist are ignored, and a section with no config entry
 * still gets a chapter, with no beat or teaser.
 */
export function buildPublicTrackStory(
  page: TrackLandingPage | null | undefined,
  sections: readonly PublicStorySection[],
  warningsBySection: StoryWarningsBySection = new Map(),
): PublicTrackStory | null {
  const hook = page?.hero.hook;
  if (!page || !hook) return null;

  const sectionIds = new Set(sections.map((section) => section.id));
  const { firstMove, arc, outcomes, howItPlays, cast, persona } = page;

  const replies = firstMove.replies.filter(
    (reply) => reply.text.trim() !== '' && reply.label.trim() !== '',
  );
  const showFirstMove =
    firstMove.enabled &&
    firstMove.personaLine !== null &&
    replies.length >= LANDING_FIRST_MOVE_MIN_REPLIES;

  const configBySection = new Map(
    arc.chapters.map((chapter) => [chapter.sectionId, chapter]),
  );

  const showCast =
    cast.enabled && (persona.name !== null || cast.guide.name !== null);

  const contentNotes = buildContentNotes(
    sections,
    warningsBySection,
    page.contentNotes.extraNote,
  );

  return {
    hook,
    question: page.hero.question,
    courseLine: page.hero.courseLine,
    buttonLabel: page.hero.buttonLabel,
    persona: persona.name
      ? {
          name: persona.name,
          descriptor: persona.descriptor,
          imageUrl: persona.imageUrl,
        }
      : null,
    firstMove:
      showFirstMove && firstMove.personaLine
        ? {
            sceneLine: firstMove.sceneLine,
            personaLine: firstMove.personaLine,
            prompt: firstMove.prompt,
            replies: replies.map(({ text, label, why }) => ({
              text,
              label,
              why,
            })),
          }
        : null,
    // A course with no sections has no arc to draw, whatever the switch says.
    arc:
      arc.enabled && sections.length > 0
        ? {
            chapters: sections.map((section) => ({
              sectionId: section.id,
              beat: configBySection.get(section.id)?.beat ?? null,
              teaser: configBySection.get(section.id)?.teaser ?? null,
            })),
            hardCallSectionId:
              arc.hardCallSectionId && sectionIds.has(arc.hardCallSectionId)
                ? arc.hardCallSectionId
                : null,
          }
        : null,
    outcomes:
      outcomes.enabled && outcomes.items.length > 0
        ? [...outcomes.items]
        : null,
    howItPlays: howItPlays.enabled
      ? { sittingLength: howItPlays.sittingLength }
      : null,
    cast: showCast
      ? {
          caller: persona.name
            ? {
                name: persona.name,
                line: cast.callerLine,
                imageUrl: persona.imageUrl,
              }
            : null,
          guide: cast.guide.name
            ? {
                name: cast.guide.name,
                role: cast.guide.role,
                line: cast.guide.line,
              }
            : null,
        }
      : null,
    xp: page.xp.enabled ? buildXpLine(sections) : null,
    contentNotes,
  };
}

/**
 * A trigger warning's name in the learner's language: `translations` is keyed
 * by language code (`{ hi: { name } }`), the same lookup the scenario catalog
 * does. Falls back to the English `name` when there is no translation, or the
 * language is English, so a half-translated warning still reads in full.
 */
export function localiseTriggerWarningName(
  name: string,
  translations: unknown,
  languageCode: string | null | undefined,
): string {
  if (!languageCode) return name;
  const byLanguage = asRecord(translations);
  const base = languageCode.split('-')[0];
  const translated =
    asText(asRecord(byLanguage[languageCode]).name) ??
    asText(asRecord(byLanguage[base]).name);
  return translated ?? name;
}

/**
 * XP the activities can pay, as an upper bound. Each item pays its
 * `TRACK_ITEM_XP` on completion; a roleplay pays 0 there, because its session
 * already earns the completion award plus practice minutes — the minutes are
 * open-ended, so the page states them separately ("plus XP for every minute you
 * practise") and this number stays honest under the daily caps.
 */
function buildXpLine(sections: readonly PublicStorySection[]): {
  activityXp: number;
  hasRoleplays: boolean;
} {
  let activityXp = 0;
  let roleplays = 0;
  for (const section of sections) {
    for (const item of section.items) {
      activityXp += TRACK_ITEM_XP[item.type] ?? 0;
      if (item.type === TrackItemType.ROLEPLAY) {
        roleplays += 1;
        activityXp += XP_AWARD.PER_SESSION_COMPLETED;
      }
    }
  }
  return { activityXp, hasRoleplays: roleplays > 0 };
}

/**
 * Content notes are automatic: any warning on the course's roleplay scenarios
 * produces the block, and the author cannot switch it off while one exists.
 * Each name appears once, with the 1-based positions of every chapter that
 * carries it (ascending), listed in the order a learner first meets it.
 */
function buildContentNotes(
  sections: readonly PublicStorySection[],
  warningsBySection: StoryWarningsBySection,
  extraNote: string | null,
): PublicTrackStory['contentNotes'] {
  const chaptersByName = new Map<string, number[]>();
  sections.forEach((section, index) => {
    const names = [
      ...new Set(
        (warningsBySection.get(section.id) ?? [])
          .map((name) => name.trim())
          .filter((name) => name !== ''),
      ),
    ].sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      chaptersByName.set(name, [
        ...(chaptersByName.get(name) ?? []),
        index + 1,
      ]);
    }
  });

  if (chaptersByName.size === 0 && extraNote === null) return null;
  return {
    warnings: [...chaptersByName].map(([name, chapters]) => ({
      name,
      chapters,
    })),
    extraNote,
  };
}
