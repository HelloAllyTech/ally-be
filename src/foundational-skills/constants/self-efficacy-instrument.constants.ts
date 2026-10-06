import {
  FHS_RUBRIC,
  FhsSkill,
  FhsTier,
} from './helping-skills-rubric.constants';

/**
 * The learner self-efficacy instrument: how confident a learner says they are
 * at each foundational helping skill, asked at onboarding and again as they
 * practise, so a change in confidence can be set beside the judge's change in
 * level for the same person (Highlights → Quality & sentiment, AAQ-230/231).
 *
 * ## Shape (decision recorded 2026-10-05)
 *
 * One **0–10** confidence item per rubric skill, 14 in all, keyed by the rubric
 * skill key and worded with the rubric's own skill name — the learner rates the
 * same thing the judge scores. Tier roll-ups are derived at read time, never
 * asked. 0–10 rather than 1–5 because the instrument is a scaling question
 * repeated over time: rate yourself at baseline, then revisit the same
 * questions periodically to see how your view has changed (Stacks: "Scaling
 * Questions for Measuring Supervisee Development").
 *
 * The answer is never reported as an outcome on its own. Learners are poor and
 * often over-confident self-assessors, and those performing least well
 * self-assess least well, so every chart that reads it triangulates it with the
 * judge (Stacks: "Include Self-Assessment Despite Known Accuracy Limitations").
 *
 * ## Changing anything in this file
 *
 * Wording, scale, anchors and item set ARE the instrument: change any of them
 * and add a new version beside `v1` (keep the old one so its rows still
 * describe what was asked), then point `SELF_EFFICACY_INSTRUMENT_VERSION` at
 * it. The analytics read one version at a time, like the rubric. Items are
 * keyed by the stored rubric skill keys, so a rubric skill that is retired or
 * added also means a new instrument version — the spec beside this file fails
 * until it is made.
 */

export interface SelfEfficacyItem {
  /** Rubric skill key (`FHS_RUBRIC[].key`) — the key the answer is stored under. */
  skill: string;
  /** The rubric's own name for the skill, shown as the item's label. */
  name: string;
  tier: FhsTier;
  /** The question as the learner reads it. */
  prompt: string;
}

export interface SelfEfficacyInstrument {
  version: string;
  /** Shown once above the items. */
  stem: string;
  scale: {
    min: number;
    max: number;
    /** Labels for the two ends of the scale only; the points between are numbers. */
    anchors: { min: string; max: string };
  };
  items: readonly SelfEfficacyItem[];
}

/** What defines one instrument version, as plain data (built into items on first use). */
interface SelfEfficacyInstrumentSpec {
  stem: string;
  scale: SelfEfficacyInstrument['scale'];
  /** Rubric skill keys, in the order the learner sees them. */
  skills: readonly string[];
}

/**
 * Every instrument version ever asked, by version. Never delete one — its rows
 * still describe what was asked.
 *
 * v1 lists the skills in rubric order, so the learner sees them grouped by
 * tier as the rubric lists them.
 */
const SPECS: Readonly<Record<string, SelfEfficacyInstrumentSpec>> = {
  v1: {
    stem: 'Rate how confident you feel right now in each of these helping skills, from 0 (not at all confident) to 10 (completely confident). There are no right answers, and you can skip any skill.',
    scale: {
      min: 0,
      max: 10,
      anchors: { min: 'Not at all confident', max: 'Completely confident' },
    },
    skills: [
      'verbal',
      'confidentiality',
      'rapport',
      'feelings',
      'empathy',
      'harm',
      'functioning',
      'explanation',
      'family',
      'goals',
      'hope',
      'coping',
      'psychoeducation',
      'feedback',
    ],
  },
};

/** Every version that exists, current or retired. */
export const SELF_EFFICACY_INSTRUMENT_VERSIONS: readonly string[] =
  Object.keys(SPECS);

/** The version learners are asked now, and the only one the analytics read. */
export const SELF_EFFICACY_INSTRUMENT_VERSION = 'v1';

/**
 * One item, worded from the rubric's skill name. The name follows a colon
 * rather than being spliced into a sentence because the 14 names are not one
 * grammatical form ("Verbal communication", "Explain and promote
 * confidentiality", "Promote realistic hope for change").
 */
function item(
  skill: string,
  rubric: ReadonlyMap<string, FhsSkill>,
): SelfEfficacyItem {
  const found = rubric.get(skill);
  if (!found) {
    throw new Error(
      `Self-efficacy item "${skill}" is not a rubric skill — add a new instrument version instead`,
    );
  }
  return {
    skill,
    name: found.name,
    tier: found.tier,
    prompt: `How confident are you in this skill: ${found.name}?`,
  };
}

const built = new Map<string, SelfEfficacyInstrument>();

/**
 * The instrument for `version`, or null when there is no such version. Built
 * on first use and memoised — never at import time, so a rubric change that
 * breaks an item fails the call (and this file's spec), not every suite that
 * happens to import the module.
 */
export function selfEfficacyInstrument(
  version: string,
): SelfEfficacyInstrument | null {
  const cached = built.get(version);
  if (cached) return cached;
  if (!Object.prototype.hasOwnProperty.call(SPECS, version)) return null;
  const spec = SPECS[version];
  const rubric = new Map<string, FhsSkill>(FHS_RUBRIC.map((s) => [s.key, s]));
  const instrument: SelfEfficacyInstrument = {
    version,
    stem: spec.stem,
    scale: spec.scale,
    items: spec.skills.map((skill) => item(skill, rubric)),
  };
  built.set(version, instrument);
  return instrument;
}

export const currentSelfEfficacyInstrument = (): SelfEfficacyInstrument =>
  selfEfficacyInstrument(
    SELF_EFFICACY_INSTRUMENT_VERSION,
  ) as SelfEfficacyInstrument;

/**
 * When the instrument is due (`util/self-assessment-due.util.ts`): at
 * onboarding (the baseline), again after every `everyScoredCuts` scored cuts
 * (a cut is 5,000 characters of the learner's own speech, so this is a fixed
 * amount of practice for everyone), and when a course is completed.
 */
export const SELF_EFFICACY_CADENCE = {
  everyScoredCuts: 3,
  onCourseCompletion: true,
  onOnboarding: true,
} as const;

/**
 * At most one answer per this many hours, whatever triggers fire — finishing a
 * course and crossing a cut boundary on the same day asks once, not twice. A
 * dismissed prompt (an answer with every item skipped) counts, so a learner who
 * says "not now" is not asked again on the next page load.
 */
export const SELF_EFFICACY_MIN_HOURS_BETWEEN = 24;
