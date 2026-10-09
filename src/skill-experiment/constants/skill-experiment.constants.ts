import { RubricCriterion } from '../type/skill-experiment.type';

/**
 * Skills whose call sites report their outputs, and so can run an experiment.
 *
 * Auto-improve can only judge what it can see: a skill is "connected" when its
 * call site asks `SkillExperimentRouterService.assign` which text to run and
 * hands the result to `record`. Every other skill shows "not connected yet" in
 * the admin rather than a switch that would collect nothing. Connecting one is
 * a few lines at its call site — see docs/skill-experiments.md — plus a row
 * here.
 */
export interface ConnectedSkill {
  /** Where the skill text actually runs. */
  runtime: 'ally-be' | 'ally-ai';
  /** One line for the admin: what an "output" of this skill is. */
  outputDescription: string;
  /** A starting rubric the admin can edit, so the form is never blank. */
  suggestedRubric: RubricCriterion[];
}

const DEBRIEF_RUBRIC: RubricCriterion[] = [
  {
    key: 'grounded',
    name: 'Grounded in the transcript',
    description:
      'Every strength, gap and example it cites actually happened in the roleplay; nothing is invented or generic.',
    weight: 3,
  },
  {
    key: 'actionable',
    name: 'Actionable next steps',
    description:
      'The learner can tell exactly what to do differently next time, with a concrete example of better wording.',
    weight: 3,
  },
  {
    key: 'tone',
    name: 'Supportive supervisor tone',
    description:
      'Warm, encouraging and direct, as a good clinical supervisor would be; never harsh, never empty praise.',
    weight: 2,
  },
  {
    key: 'complete',
    name: 'Complete and well-formed',
    description:
      'Fills every section the debrief format asks for, at a sensible length, with no truncation or formatting debris.',
    weight: 1,
  },
];

export const CONNECTED_SKILLS: Readonly<Record<string, ConnectedSkill>> = {
  track_quiz_open_ended_grading_user: {
    runtime: 'ally-be',
    outputDescription:
      'The grade and feedback for one open-ended quiz answer in a Track.',
    suggestedRubric: [
      {
        key: 'fair_score',
        name: 'Fair score',
        description:
          "The score matches the answer's quality against the trainer's guidance and criteria — not inflated, not harsh.",
        weight: 3,
      },
      {
        key: 'specific_feedback',
        name: 'Specific feedback',
        description:
          'The feedback names what the answer did well and what it missed, citing the answer itself.',
        weight: 2,
      },
      {
        key: 'actionable',
        name: 'Actionable',
        description:
          'The learner knows what to change to score higher next time.',
        weight: 2,
      },
      {
        key: 'tone',
        name: 'Warm, second-person tone',
        description:
          'Addressed to the learner, encouraging and respectful, 2–4 sentences.',
        weight: 1,
      },
    ],
  },
  ally_ai_scenario_scenario_evaluation: {
    runtime: 'ally-ai',
    outputDescription:
      'The debrief a learner reads after a roleplay session (scenario evaluation).',
    suggestedRubric: DEBRIEF_RUBRIC,
  },
  ally_ai_scenario_scenario_evaluation_with_memory: {
    runtime: 'ally-ai',
    outputDescription:
      'The debrief a learner reads after a roleplay session, written with their previous-session memory.',
    suggestedRubric: DEBRIEF_RUBRIC,
  },
};

export function isConnectedSkill(promptCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONNECTED_SKILLS, promptCode);
}

/** The judge's and designer's own prompts (System Skills, `src/prompts/skill_experiment/`). */
export const SKILL_EXPERIMENT_PROMPT_CODES = {
  JUDGE: 'skill_experiment_judge',
  DESIGNER: 'skill_experiment_designer',
} as const;

/** AI-task-registry row ids. */
export const SKILL_EXPERIMENT_AI_TASK_IDS = {
  JUDGE: 'skill-experiment-judge',
  DESIGNER: 'skill-experiment-designer',
} as const;

/** Defaults for a new experiment; mirrored by the column defaults in the migration. */
export const SKILL_EXPERIMENT_DEFAULTS = {
  targetScore: 85,
  minSamplesPerVariant: 30,
  challengerTrafficPercent: 30,
  maxVariants: 8,
  maxConsecutiveLosses: 3,
  minImprovement: 2,
} as const;

/** Bounds the admin form and the DTO both enforce. */
export const SKILL_EXPERIMENT_LIMITS = {
  rubricMin: 1,
  rubricMax: 10,
  weightMin: 1,
  weightMax: 5,
  targetScoreMin: 50,
  targetScoreMax: 100,
  minSamplesMin: 10,
  minSamplesMax: 500,
  trafficMin: 5,
  trafficMax: 50,
  maxVariantsMin: 1,
  maxVariantsMax: 30,
  maxLossesMin: 1,
  maxLossesMax: 10,
  minImprovementMin: 0,
  minImprovementMax: 20,
} as const;

export const SKILL_EXPERIMENT_ENGINE = {
  /** Wall-clock budget for one tick across every experiment. */
  TICK_BUDGET_MS: 4 * 60 * 1000,
  /** Outputs judged per experiment per tick. */
  JUDGE_BATCH_PER_TICK: 20,
  /** Judge calls in flight at once. */
  JUDGE_CONCURRENCY: 4,
  /** Judge attempts before an observation is marked failed and left out. */
  JUDGE_MAX_ATTEMPTS: 3,
  JUDGE_MAX_TOKENS: 8000,
  JUDGE_TIMEOUT_MS: 120_000,
  DESIGNER_MAX_TOKENS: 16000,
  DESIGNER_TIMEOUT_MS: 240_000,
  /** Drafts per design round before the round counts as a failure. */
  DESIGNER_MAX_ATTEMPTS: 3,
  /** Failed design rounds in a row before the loop pauses. */
  MAX_DESIGN_FAILURES: 3,
  /** Revised text must stay within this ratio of the champion's length. */
  MIN_LENGTH_RATIO: 0.4,
  MAX_LENGTH_RATIO: 2.5,
  /** Low-scoring examples shown to the designer. */
  DESIGNER_EXAMPLES: 5,
  /** Earlier attempts shown to the designer so it does not repeat them. */
  DESIGNER_HISTORY: 10,
  /** Unjudged outputs per experiment beyond which new ones are not recorded. */
  MAX_PENDING_PER_EXPERIMENT: 500,
  /** Truncation for what is stored and what is sent to the judge. */
  MAX_INPUT_FIELD_CHARS: 30_000,
  MAX_OUTPUT_CHARS: 100_000,
  JUDGE_FIELD_CHARS: 12_000,
  DESIGNER_EXAMPLE_CHARS: 1_500,
  /** How long the router trusts its snapshot of live experiments. */
  ROUTER_CACHE_TTL_MS: 30_000,
  /** Advisory lock (namespace, key) the background tick holds across replicas. */
  LOCK_NAMESPACE: 4919,
  LOCK_KEY: 731_502_417,
} as const;
