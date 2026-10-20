import { Injectable } from '@nestjs/common';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import {
  StoryBeat,
  TRACK_LANDING_LIMITS,
  TrackLandingPage,
} from 'src/track/type/track-landing-page.type';
import { normaliseTrackLandingPage } from 'src/track/util/track-landing-page.util';
import {
  COURSE_COPILOT_AI_TASKS,
  COURSE_COPILOT_JOB_MAX_ATTEMPTS,
  COURSE_COPILOT_PROMPTS,
} from '../../constants/course-copilot.constants';
import { SpecialistLlmService } from './specialist-llm.service';
import {
  LandingPageInput,
  LandingPageSectionInput,
  SpecialistValidationError,
} from './specialist.types';
import {
  asArray,
  asRecord,
  asText,
  htmlToText,
  isRecord,
  SPECIALIST_MAX_TOKENS,
  truncateAtWord,
  typeLabel,
} from './specialist.util';

/** A roleplay's story is context for the writer, not material to quote. */
const SCENARIO_STORY_MAX_CHARS = 300;
const OUTLINE_DESCRIPTION_MAX_CHARS = 200;
const ITEM_DESCRIPTION_MAX_CHARS = 140;
const STORY_BEATS: readonly string[] = Object.values(StoryBeat);

/**
 * Drafts a course's story-led landing page from the saved course.
 *
 * One JSON call per click, with one repair pass when the output cannot be
 * parsed or is missing what a page needs. It saves nothing: the builder merges
 * the draft into the fields the author left empty. The writer never sees quiz
 * questions or answer keys — only item titles and the roleplays' scenario
 * summaries — so there is nothing for a teaser to leak, and the prompt asks for
 * a label on the learner's move only, never a verdict on the client's outcome.
 */
@Injectable()
export class LandingPageSpecialist {
  constructor(private readonly llm: SpecialistLlmService) {}

  async generate(input: LandingPageInput): Promise<TrackLandingPage> {
    const sectionIds = input.sections.map((section) => section.id);
    const variables = {
      course_title: input.title || '(untitled)',
      course_description: input.description || '(none yet)',
      course_duration_minutes: input.durationMinutes
        ? String(input.durationMinutes)
        : 'unknown',
      course_outline: landingPageOutlineForPrompt(input.sections),
      trigger_warnings: triggerWarningsForPrompt(
        input.triggerWarnings,
        sectionIds,
      ),
      current_landing_page: input.currentPage
        ? currentPageForPrompt(input.currentPage)
        : '(none yet)',
    };

    let repairErrors: string[] | undefined;
    for (let attempt = 1; ; attempt++) {
      try {
        const { data } = await this.llm.runJson({
          specialist: 'landing_page',
          promptCode: COURSE_COPILOT_PROMPTS.LANDING_PAGE_WRITER,
          taskId: COURSE_COPILOT_AI_TASKS.LANDING_PAGE,
          task: LlmTask.COURSE_COPILOT_LANDING_PAGE,
          maxTokens: SPECIALIST_MAX_TOKENS.LANDING_PAGE,
          usageMetadata: input.usageMetadata,
          variables,
          repairErrors,
        });
        return normaliseLandingPageDraft(data, sectionIds);
      } catch (error) {
        // Only an unusable answer is worth a second try; a provider error
        // would just fail again, and the caller turns it into a readable one.
        if (
          !(error instanceof SpecialistValidationError) ||
          attempt >= COURSE_COPILOT_JOB_MAX_ATTEMPTS
        ) {
          throw error;
        }
        repairErrors = error.errors;
      }
    }
  }
}

/* ---------------------------------------------------------------- *
 * Prompt context
 * ---------------------------------------------------------------- */

const plainText = (value: unknown, max: number): string =>
  truncateAtWord(htmlToText(typeof value === 'string' ? value : ''), max);

/**
 * The sections in order, each with its id (the writer copies ids from here),
 * its items by type and title, and — for roleplays — the scenario behind them.
 */
export function landingPageOutlineForPrompt(
  sections: LandingPageSectionInput[],
): string {
  if (!sections.length) return '(the course has no sections yet)';
  const lines: string[] = [];
  sections.forEach((section, index) => {
    const description = plainText(
      section.description,
      OUTLINE_DESCRIPTION_MAX_CHARS,
    );
    lines.push(
      `Section ${index + 1} (id: ${section.id}): ${section.title || '(untitled)'}` +
        (description ? ` — ${description}` : ''),
    );
    for (const item of section.items) {
      const itemDescription = plainText(
        item.description,
        ITEM_DESCRIPTION_MAX_CHARS,
      );
      lines.push(
        `  - [${typeLabel(item.type)}] ${item.title || '(untitled)'}` +
          (itemDescription ? ` — ${itemDescription}` : ''),
      );
      const scenarioTitle = plainText(item.scenario?.title, 120);
      const story = plainText(item.scenario?.story, SCENARIO_STORY_MAX_CHARS);
      if (scenarioTitle || story) {
        lines.push(
          `      Scenario: ${scenarioTitle || '(untitled)'}` +
            (story ? ` — ${story}` : ''),
        );
      }
    }
  });
  return lines.join('\n');
}

/** "Self-harm (sections 2, 3)" per warning, in the order a learner meets them. */
export function triggerWarningsForPrompt(
  warnings: { name: string; sectionIds: string[] }[],
  sectionIds: string[],
): string {
  const lines = warnings
    .filter((warning) => warning.name.trim() !== '')
    .map((warning) => {
      const positions = sectionIds
        .map((id, index) => (warning.sectionIds.includes(id) ? index + 1 : 0))
        .filter(Boolean);
      return `- ${warning.name.trim()}${
        positions.length
          ? ` (${positions.length === 1 ? 'section' : 'sections'} ${positions.join(', ')})`
          : ''
      }`;
    });
  return lines.join('\n') || '(none)';
}

/** The saved page without the fields the writer neither reads nor may set. */
function currentPageForPrompt(page: TrackLandingPage): Record<string, unknown> {
  return {
    hero: page.hero,
    persona: { name: page.persona.name, descriptor: page.persona.descriptor },
    firstMove: page.firstMove,
    arc: page.arc,
    outcomes: page.outcomes,
    howItPlays: page.howItPlays,
    cast: page.cast,
    contentNotes: page.contentNotes,
  };
}

/* ---------------------------------------------------------------- *
 * Normalise the model's draft
 * ---------------------------------------------------------------- */

/**
 * The prompt forbids exclamation marks; code enforces it, because a model that
 * ignores one rule in a long prompt is routine and a page that shouts about a
 * helpline call is not something an author should have to find by eye.
 */
const calm = (text: string): string =>
  text.replace(/([.?])?!+/g, (_match, stop?: string) => stop ?? '.');

/** Trimmed, calmed, cut at a word boundary; null when nothing is left. */
function field(value: unknown, max: number): string | null {
  const text = asText(value);
  if (!text) return null;
  return truncateAtWord(calm(text), max) || null;
}

/**
 * Pure: raw model JSON → the full `TrackLandingPage`. Exported for tests.
 *
 * Every field is cut at a word boundary to its limit; only ids of sections
 * that exist survive; exactly one hard call is forced whenever the course has a
 * section. Every block comes back switched on and the persona has no image or
 * character id, because the draft is text only — the author attaches those.
 * Throws `SpecialistValidationError` (so the repair pass runs) when the answer
 * has no hook, or no chapter for any section the course has.
 */
export function normaliseLandingPageDraft(
  raw: Record<string, any>,
  sectionIds: string[],
): TrackLandingPage {
  const root = isRecord(raw.landingPage)
    ? raw.landingPage
    : isRecord(raw.draft)
      ? raw.draft
      : raw;
  const hero = asRecord(root.hero);
  const persona = asRecord(root.persona);
  const firstMove = asRecord(root.firstMove);
  const arc = asRecord(root.arc);
  const outcomes = root.outcomes;
  const howItPlays = asRecord(root.howItPlays);
  const cast = asRecord(root.cast);
  const guide = asRecord(cast.guide);
  const contentNotes = asRecord(root.contentNotes);

  const chapters = draftChapters(arc.chapters ?? root.chapters, sectionIds);
  const guideName = field(guide.name, TRACK_LANDING_LIMITS.guideName);

  const page = normaliseTrackLandingPage({
    hero: {
      hook: field(hero.hook, TRACK_LANDING_LIMITS.hook),
      question: field(hero.question, TRACK_LANDING_LIMITS.question),
      courseLine: field(hero.courseLine, TRACK_LANDING_LIMITS.courseLine),
      buttonLabel: field(hero.buttonLabel, TRACK_LANDING_LIMITS.buttonLabel),
    },
    persona: {
      name: field(persona.name, TRACK_LANDING_LIMITS.personaName),
      descriptor: field(
        persona.descriptor,
        TRACK_LANDING_LIMITS.personaDescriptor,
      ),
      imageUrl: null,
      characterId: null,
    },
    firstMove: {
      enabled: true,
      sceneLine: field(firstMove.sceneLine, TRACK_LANDING_LIMITS.sceneLine),
      personaLine: field(
        firstMove.personaLine,
        TRACK_LANDING_LIMITS.personaLine,
      ),
      prompt: field(firstMove.prompt, TRACK_LANDING_LIMITS.prompt),
      replies: asArray(firstMove.replies)
        .filter(isRecord)
        .map((reply) => ({
          text: field(reply.text, TRACK_LANDING_LIMITS.replyText),
          label: field(reply.label, TRACK_LANDING_LIMITS.replyLabel),
          why: field(reply.why, TRACK_LANDING_LIMITS.replyWhy),
        })),
    },
    arc: {
      enabled: true,
      chapters,
      hardCallSectionId: pickHardCall(
        arc.hardCallSectionId,
        chapters,
        sectionIds,
      ),
    },
    outcomes: {
      enabled: true,
      items: asArray(isRecord(outcomes) ? outcomes.items : outcomes).map(
        (item) => field(item, TRACK_LANDING_LIMITS.outcome),
      ),
    },
    howItPlays: {
      enabled: true,
      sittingLength: asText(howItPlays.sittingLength).toUpperCase(),
    },
    cast: {
      enabled: true,
      callerLine: field(cast.callerLine, TRACK_LANDING_LIMITS.callerLine),
      // A guide with no name is never shown, so its role and line go with it.
      guide: guideName
        ? {
            name: guideName,
            role: field(guide.role, TRACK_LANDING_LIMITS.guideRole),
            line: field(guide.line, TRACK_LANDING_LIMITS.guideLine),
          }
        : { name: null, role: null, line: null },
    },
    xp: { enabled: true },
    contentNotes: {
      extraNote: field(contentNotes.extraNote, TRACK_LANDING_LIMITS.extraNote),
    },
  });

  const problems: string[] = [];
  if (!page.hero.hook) {
    problems.push(
      'hero.hook is missing: write a hook of at most 140 characters.',
    );
  }
  if (sectionIds.length > 0 && page.arc.chapters.length === 0) {
    problems.push(
      'arc.chapters has no entry for any section id in the outline: ' +
        'give every section a chapter, copying its id exactly.',
    );
  }
  if (problems.length > 0) throw new SpecialistValidationError(problems);
  return page;
}

/** Chapters for sections that exist, in section order, last entry per id winning. */
function draftChapters(
  value: unknown,
  sectionIds: string[],
): { sectionId: string; beat: StoryBeat | null; teaser: string | null }[] {
  const known = new Set(sectionIds);
  const byId = new Map<
    string,
    { sectionId: string; beat: StoryBeat | null; teaser: string | null }
  >();
  for (const entry of asArray(value).filter(isRecord)) {
    const sectionId = asText(entry.sectionId);
    if (!known.has(sectionId)) continue;
    const beat = asText(entry.beat).toUpperCase();
    byId.set(sectionId, {
      sectionId,
      beat: STORY_BEATS.includes(beat) ? (beat as StoryBeat) : null,
      teaser: field(entry.teaser, TRACK_LANDING_LIMITS.teaser),
    });
  }
  return sectionIds.flatMap((id) => {
    const chapter = byId.get(id);
    return chapter ? [chapter] : [];
  });
}

/**
 * The model's hard call when it names a real section; otherwise the last
 * climax chapter, otherwise the last section — the hardest practice sits near
 * the end of a course. Null only for a course with no sections.
 */
function pickHardCall(
  requested: unknown,
  chapters: { sectionId: string; beat: StoryBeat | null }[],
  sectionIds: string[],
): string | null {
  if (sectionIds.length === 0) return null;
  const id = asText(requested);
  if (sectionIds.includes(id)) return id;
  const climax = [...chapters]
    .reverse()
    .find((chapter) => chapter.beat === StoryBeat.CLIMAX);
  return climax?.sectionId ?? sectionIds[sectionIds.length - 1];
}
