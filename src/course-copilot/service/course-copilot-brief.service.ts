import { Injectable } from '@nestjs/common';
import { applyJsonPatch, JsonPatchOp } from 'src/common/util/json-patch.util';
import {
  CourseBrief,
  CourseBriefAssessmentKind,
  CourseBriefComponent,
  CourseBriefPracticeSlot,
  CourseBriefReadiness,
} from '../type/course-copilot.type';
import { COURSE_COPILOT_LIMITS } from '../constants/course-copilot.constants';

const ASSESSMENT_KINDS: CourseBriefAssessmentKind[] = [
  'roleplay',
  'quiz',
  'annotated_artifact',
  'journal',
];
const COMPONENTS: CourseBriefComponent[] = [
  'article',
  'video',
  'journal',
  'annotated_artifact',
  'game',
  'quiz',
];
const PRACTICE_WEIGHTS = ['practice-heavy', 'balanced', 'reading-heavy'];
const COVER_MODES = ['generate', 'library', 'upload-later'];
const ARTICLE_IMAGE_MODES = ['none', 'cover-only', 'one-per-article'];
const VIDEO_SOURCES = ['youtube', 'vimeo', 'loom', 's3'];

const TOP_LEVEL_KEYS = new Set([
  'seed',
  'audience',
  'outcomes',
  'competencyIds',
  'competencyNames',
  'behaviours',
  'assessment',
  'shape',
  'practice',
  'look',
  'videoUrls',
  'notes',
]);

export interface BriefPatchResult {
  brief: CourseBrief;
  readiness: CourseBriefReadiness;
  /** Keys the model wrote that the brief does not declare — NOT stored. */
  ignoredKeys: string[];
}

const str = (value: unknown): string | undefined => {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const strList = (value: unknown, max = 50): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  const list = (Array.isArray(value) ? value : [value])
    .map(str)
    .filter((entry): entry is string => Boolean(entry));
  return list.slice(0, max);
};

const num = (value: unknown): number | undefined => {
  // A blank string is "not given", not 0 — a blank minScore must not become
  // "no gate".
  if (typeof value === 'string' && !value.trim()) return undefined;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? parsed
    : undefined;
};

const pick = <T extends string>(value: unknown, allowed: readonly string[]) =>
  typeof value === 'string' && allowed.includes(value)
    ? (value as T)
    : undefined;

/** Drop undefined members so the stored jsonb carries only what was said. */
const compact = <T extends Record<string, any>>(value: T): T | undefined => {
  const entries = Object.entries(value).filter(
    ([, entry]) => entry !== undefined,
  );
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
};

/**
 * The brief: patching, normalising and the readiness guard.
 *
 * Normalisation is lenient on purpose. The model writes this document, and a
 * strict schema that rejects a patch because a number arrived as "60" costs a
 * whole tool round-trip to learn nothing. So values are coerced where the
 * intent is unambiguous and undeclared keys are dropped AND reported back —
 * the Builder lesson: an agent told only "ok" will keep writing a key nobody
 * stores, and spend its budget wondering why nothing moved.
 */
@Injectable()
export class CourseCopilotBriefService {
  applyPatch(current: CourseBrief, ops: JsonPatchOp[]): BriefPatchResult {
    const patched = applyJsonPatch<Record<string, any>>(
      // Seed missing containers so `add /audience/who` works on an empty brief
      // without the model first having to create `/audience`.
      this.withContainers(current ?? {}),
      ops,
    );
    const ignoredKeys = Object.keys(patched ?? {}).filter(
      (key) => !TOP_LEVEL_KEYS.has(key),
    );
    const brief = this.normalise(patched);

    // Nothing the trainer said may be lost: notes only ever grow. A patch that
    // shrinks them is almost always a `replace /notes` that meant `add`.
    const before = current?.notes?.length ?? 0;
    const after = brief.notes?.length ?? 0;
    if (after < before) {
      throw new Error(
        `This patch would drop ${before - after} note(s). Notes only grow — ` +
          'append with {"op":"add","path":"/notes/-","value":"…"} instead of replacing the list.',
      );
    }

    return { brief, readiness: this.readiness(brief), ignoredKeys };
  }

  /**
   * What `propose_blueprint` needs before it will run. Clearance only, no
   * score — the Builder rubric lesson: a score over vacuous checks reads as
   * progress nobody made.
   */
  readiness(brief: CourseBrief | null | undefined): CourseBriefReadiness {
    const missing: string[] = [];
    if (!brief?.seed) missing.push('what the course is for');
    if (!brief?.audience?.who) missing.push('who the learners are');
    if (!brief?.outcomes?.terminal) {
      missing.push('the end-of-course outcome');
    }
    if (!brief?.competencyIds?.length) missing.push('at least one competency');
    if (!brief?.assessment?.kind) {
      missing.push('how mastery is assessed');
    }
    if (!brief?.shape?.durationMinutes) missing.push('the time budget');
    if (!brief?.shape?.languageIds?.length) missing.push('the language');
    return { ready: missing.length === 0, missing };
  }

  normalise(raw: unknown): CourseBrief {
    const source = (raw && typeof raw === 'object' ? raw : {}) as Record<
      string,
      any
    >;
    const brief: CourseBrief = {};

    const seed = str(source.seed);
    if (seed) brief.seed = seed;

    const audience = compact({
      who: str(source.audience?.who),
      priorExperience: str(source.audience?.priorExperience),
      applicationContext: str(source.audience?.applicationContext),
      groupNote: str(source.audience?.groupNote),
    });
    if (audience) brief.audience = audience;

    const enabling = strList(source.outcomes?.enabling, 8);
    const outcomes = compact({
      terminal: str(source.outcomes?.terminal),
      enabling: enabling?.length ? enabling : undefined,
    });
    if (outcomes) brief.outcomes = outcomes;

    const competencyIds = strList(
      source.competencyIds,
      COURSE_COPILOT_LIMITS.competencies,
    );
    if (competencyIds?.length) brief.competencyIds = competencyIds;
    const competencyNames = strList(
      source.competencyNames,
      COURSE_COPILOT_LIMITS.competencies,
    );
    if (competencyNames?.length) brief.competencyNames = competencyNames;

    const helpful = strList(source.behaviours?.helpful, 12);
    const unhelpful = strList(source.behaviours?.unhelpful, 12);
    const behaviours = compact({
      helpful: helpful?.length ? helpful : undefined,
      unhelpful: unhelpful?.length ? unhelpful : undefined,
    });
    if (behaviours) brief.behaviours = behaviours;

    const assessment = compact({
      kind: pick<CourseBriefAssessmentKind>(
        source.assessment?.kind,
        ASSESSMENT_KINDS,
      ),
      note: str(source.assessment?.note),
      threshold: num(source.assessment?.threshold),
    });
    if (assessment) brief.assessment = assessment;

    const components = strList(source.shape?.components)?.filter(
      (entry): entry is CourseBriefComponent =>
        COMPONENTS.includes(entry as CourseBriefComponent),
    );
    const languageIds = strList(source.shape?.languageIds, 6)?.filter((id) =>
      /^\d+$/.test(id),
    );
    const durationMinutes = num(source.shape?.durationMinutes);
    const sections = num(source.shape?.sections);
    const shape = compact({
      durationMinutes:
        durationMinutes && durationMinutes > 0
          ? Math.round(durationMinutes)
          : undefined,
      sections:
        sections && sections > 0
          ? Math.min(Math.round(sections), COURSE_COPILOT_LIMITS.sections)
          : undefined,
      practiceWeight: pick<'practice-heavy' | 'balanced' | 'reading-heavy'>(
        source.shape?.practiceWeight,
        PRACTICE_WEIGHTS,
      ),
      components: components?.length ? components : undefined,
      tone: str(source.shape?.tone),
      readingLevel: str(source.shape?.readingLevel),
      languageIds: languageIds?.length ? languageIds : undefined,
    });
    if (shape) brief.shape = shape;

    if (Array.isArray(source.practice)) {
      const practice = source.practice
        .map((slot: any, index: number) => this.normaliseSlot(slot, index))
        .filter((slot): slot is CourseBriefPracticeSlot => Boolean(slot))
        .slice(0, 12);
      if (practice.length) brief.practice = practice;
    }

    const look = compact({
      cover: pick<'generate' | 'library' | 'upload-later'>(
        source.look?.cover,
        COVER_MODES,
      ),
      coverImageUrl: str(source.look?.coverImageUrl),
      articleImages: pick<'none' | 'cover-only' | 'one-per-article'>(
        source.look?.articleImages,
        ARTICLE_IMAGE_MODES,
      ),
    });
    if (look) brief.look = look;

    if (Array.isArray(source.videoUrls)) {
      const videos = source.videoUrls
        .map((video: any) => {
          const url = str(video?.url);
          if (!url || !/^https?:\/\//i.test(url)) return null;
          return {
            title: str(video?.title) ?? 'Video',
            url,
            source:
              pick<'youtube' | 'vimeo' | 'loom' | 's3'>(
                video?.source,
                VIDEO_SOURCES,
              ) ?? this.inferVideoSource(url),
            ...(num(video?.durationSeconds)
              ? { durationSeconds: num(video.durationSeconds) }
              : {}),
          };
        })
        .filter(Boolean)
        .slice(0, 10) as CourseBrief['videoUrls'];
      if (videos?.length) brief.videoUrls = videos;
    }

    const notes = strList(source.notes, 100);
    if (notes?.length) brief.notes = notes;

    return brief;
  }

  inferVideoSource(url: string): 'youtube' | 'vimeo' | 'loom' | 's3' {
    const host = (() => {
      try {
        return new URL(url).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('vimeo')) return 'vimeo';
    if (host.includes('loom')) return 'loom';
    return 's3';
  }

  private normaliseSlot(
    raw: any,
    index: number,
  ): CourseBriefPracticeSlot | null {
    if (!raw || typeof raw !== 'object') return null;
    const scenarioId = num(raw.scenarioId);
    const source: 'library' | 'new' =
      raw.source === 'library' && (scenarioId || str(raw.caseId))
        ? 'library'
        : 'new';
    const minScore = num(raw.minScore);
    const triggerWarningIds = strList(raw.triggerWarningIds, 10);
    return {
      slot: num(raw.slot) ?? index + 1,
      source,
      ...(source === 'library' && scenarioId ? { scenarioId } : {}),
      ...(source === 'library' && str(raw.caseId)
        ? { caseId: str(raw.caseId) }
        : {}),
      ...(str(raw.characterId) ? { characterId: str(raw.characterId) } : {}),
      ...(str(raw.personaBrief) ? { personaBrief: str(raw.personaBrief) } : {}),
      ...(str(raw.taskClass) ? { taskClass: str(raw.taskClass) } : {}),
      ...(minScore !== undefined
        ? { minScore: Math.max(0, Math.min(100, minScore)) }
        : {}),
      ...(triggerWarningIds?.length ? { triggerWarningIds } : {}),
      ...(raw.saveCharacter === true ? { saveCharacter: true } : {}),
    };
  }

  private withContainers(brief: CourseBrief): Record<string, any> {
    return {
      ...brief,
      audience: brief.audience ?? {},
      // Nested arrays too, so "/shape/languageIds/-" appends on an empty brief.
      outcomes: { enabling: [], ...(brief.outcomes ?? {}) },
      behaviours: { helpful: [], unhelpful: [], ...(brief.behaviours ?? {}) },
      assessment: brief.assessment ?? {},
      shape: { components: [], languageIds: [], ...(brief.shape ?? {}) },
      look: brief.look ?? {},
      practice: brief.practice ?? [],
      videoUrls: brief.videoUrls ?? [],
      notes: brief.notes ?? [],
      competencyIds: brief.competencyIds ?? [],
      competencyNames: brief.competencyNames ?? [],
    };
  }
}
