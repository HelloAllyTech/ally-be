import { FHS_RUBRIC } from 'src/foundational-skills/constants/helping-skills-rubric.constants';
import { COURSE_IMPACT_COMPETENCY_SKILLS } from '../constants/course-impact.constants';
import type { CompetencyMapRow } from '../repository/competency-map-analytics.repository';
import type { FoundationalSkillsLearnerCutRow } from '../repository/foundational-skills-analytics.repository';

/**
 * The SCORE axis of the competency map (AAQ-048), on the learner ruler R1.
 *
 * Until 2026-10 a competency's "proficiency" was the median of
 * `scenario_session_details."compositeScore"` over sessions on scenarios
 * carrying the tag — the LLM judge's score of the AI ACTOR, not the learner.
 * It is now: for the foundational helping skill the tag names, the mean level
 * (1–4) the learner reached on that skill, over the scored cuts that were
 * practised wholly on one scenario carrying the tag and gave the skill an
 * opportunity.
 *
 * Three rules, each a place the reading could otherwise go wrong:
 *
 *  - **Only single-scenario cuts.** A cut is a 5,000-character slice of the
 *    learner's speech and can span several sessions on different scenarios;
 *    there is no per-session skill score to split it by. A cut counts towards
 *    a scenario's tags only when EVERY session in it ran that one scenario
 *    (plan §4, "scenario attribution for a cut"). The share of cuts that
 *    qualify travels in the response so the reader can see how much practice
 *    the scores rest on.
 *  - **The tag's own skill, and only where it was assessable.** Tag name →
 *    rubric key via `COURSE_IMPACT_COMPETENCY_SKILLS` (the exact-name table
 *    course impact uses). A cut whose `skillLevels` lacks that key had no
 *    opportunity for the skill — it is left out, never scored low. A tag with
 *    no rubric equivalent (Non-Verbal Communication, Linking Emotions…, any
 *    custom competency) keeps its volume and gets `noRubricSkill`.
 *  - **Floors on cuts, counts always travel.** Below `sampleFloor` assessable
 *    cuts the score is null with `tooFewCuts`; `scoredCuts`, `taggedCuts` and
 *    `scoreLearners` are returned regardless.
 */

export type CompetencyScoreUnavailable = 'noRubricSkill' | 'tooFewCuts';

export const COMPETENCY_SCORE_UNAVAILABLE: readonly CompetencyScoreUnavailable[] =
  ['noRubricSkill', 'tooFewCuts'];

export interface CompetencyScoreRow extends CompetencyMapRow {
  skill: string | null;
  skillName: string | null;
  score: number | null;
  taggedCuts: number;
  scoredCuts: number;
  scoreLearners: number;
  scoreUnavailable: CompetencyScoreUnavailable | null;
}

export interface CompetencyCutAttribution {
  /** Every scored cut in scope. */
  scoredCuts: number;
  /** Of those, cuts whose sessions all ran one (still existing) scenario. */
  singleScenarioCuts: number;
  /** singleScenarioCuts / scoredCuts × 100, 1 dp; null below the floor. */
  singleScenarioPct: number | null;
  /** Single-scenario cuts whose scenario carries no competency tag. */
  untaggedCuts: number;
}

export interface CompetencyScores {
  rows: CompetencyScoreRow[];
  cutAttribution: CompetencyCutAttribution;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;

const SKILL_NAMES = new Map(FHS_RUBRIC.map((s) => [s.key, s.name]));

/**
 * The one scenario every session of a cut ran, or null when the cut spans
 * more than one, any session's scenario is unknown, or it has no sessions.
 */
export function singleScenarioOf(
  sessionIds: readonly string[],
  sessionScenario: ReadonlyMap<string, { scenarioId: number | null }>,
): number | null {
  let only: number | null = null;
  for (const sessionId of sessionIds) {
    const scenarioId = sessionScenario.get(sessionId)?.scenarioId ?? null;
    if (scenarioId === null) return null;
    if (only === null) only = scenarioId;
    else if (scenarioId !== only) return null;
  }
  return only;
}

/** The rubric key a competency name maps to, or null. Exact-name, as course impact. */
export const competencySkill = (name: string): string | null =>
  COURSE_IMPACT_COMPETENCY_SKILLS[name] ?? null;

/**
 * Attach the learner-ruler score to every volume row.
 *
 * Mean over CUTS (each assessable single-scenario cut is one observation), as
 * the volume axis counts sessions; `scoreLearners` says how many people those
 * cuts came from, so a score resting on one heavy practiser is visible.
 */
export function buildCompetencyScores(
  volume: readonly CompetencyMapRow[],
  cuts: readonly FoundationalSkillsLearnerCutRow[],
  sessionScenario: ReadonlyMap<string, { scenarioId: number | null }>,
  scenarioTags: ReadonlyMap<number, readonly string[]>,
  sampleFloor: number,
): CompetencyScores {
  const single = cuts
    .map((c) => ({
      cut: c,
      scenarioId: singleScenarioOf(c.sessionIds, sessionScenario),
    }))
    .filter(
      (x): x is { cut: FoundationalSkillsLearnerCutRow; scenarioId: number } =>
        x.scenarioId !== null,
    );

  const rows = volume.map((row): CompetencyScoreRow => {
    const skill = competencySkill(row.name);
    if (skill === null) {
      return {
        ...row,
        skill: null,
        skillName: null,
        score: null,
        taggedCuts: 0,
        scoredCuts: 0,
        scoreLearners: 0,
        scoreUnavailable: 'noRubricSkill',
      };
    }
    const tagged = single.filter((x) =>
      (scenarioTags.get(x.scenarioId) ?? []).includes(row.competencyId),
    );
    const assessable = tagged.filter(
      (x) => typeof x.cut.levels[skill] === 'number',
    );
    const levels = assessable.map((x) => x.cut.levels[skill]);
    const shown = levels.length >= sampleFloor && levels.length > 0;
    return {
      ...row,
      skill,
      skillName: SKILL_NAMES.get(skill) ?? null,
      score: shown
        ? round2(levels.reduce((a, b) => a + b, 0) / levels.length)
        : null,
      taggedCuts: tagged.length,
      scoredCuts: levels.length,
      scoreLearners: new Set(assessable.map((x) => x.cut.userId)).size,
      scoreUnavailable: shown ? null : 'tooFewCuts',
    };
  });

  const untaggedCuts = single.filter(
    (x) => (scenarioTags.get(x.scenarioId) ?? []).length === 0,
  ).length;

  return {
    rows,
    cutAttribution: {
      scoredCuts: cuts.length,
      singleScenarioCuts: single.length,
      singleScenarioPct:
        cuts.length >= sampleFloor && cuts.length > 0
          ? round1((single.length / cuts.length) * 100)
          : null,
      untaggedCuts,
    },
  };
}
