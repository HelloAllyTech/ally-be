import {
  parseFirstJsonObject,
  stripMarkdownFences,
} from 'src/learn/util/autofill-shared.util';
import {
  CriterionVerdicts,
  RubricCriterion,
} from '../type/skill-experiment.type';

export interface JudgeVerdict {
  criteria: CriterionVerdicts;
  summary: string;
}

/**
 * Validate the judge's reply against the rubric it was given.
 *
 * Throws on anything incomplete rather than scoring what is there: a reply that
 * omits a criterion is not "neutral on it", and averaging over the criteria it
 * happened to answer would silently re-weight the rubric. The caller retries.
 */
export function parseJudgeVerdict(
  raw: string,
  rubric: RubricCriterion[],
): JudgeVerdict {
  const parsed = parseFirstJsonObject(stripMarkdownFences(raw));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Judge reply was not a JSON object');
  }
  const answers = parsed.criteria;
  if (!answers || typeof answers !== 'object') {
    throw new Error('Judge reply had no "criteria" object');
  }

  const criteria: CriterionVerdicts = {};
  for (const criterion of rubric) {
    const answer = answers[criterion.key];
    const score = Number(answer?.score);
    if (!Number.isFinite(score) || score < 1 || score > 5) {
      throw new Error(
        `Judge reply had no valid 1–5 score for criterion "${criterion.key}"`,
      );
    }
    criteria[criterion.key] = {
      score: Math.round(score),
      reason: typeof answer?.reason === 'string' ? answer.reason.trim() : '',
    };
  }

  return {
    criteria,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
  };
}

/**
 * Weighted rubric score on 0–100: each 1–5 answer maps to 0–100 linearly
 * (1 → 0, 5 → 100) and criteria are averaged by weight.
 */
export function weightedScore(
  criteria: CriterionVerdicts,
  rubric: RubricCriterion[],
): number {
  let total = 0;
  let weights = 0;
  for (const criterion of rubric) {
    const verdict = criteria[criterion.key];
    if (!verdict) continue;
    const weight = Math.max(criterion.weight, 0);
    total += ((verdict.score - 1) / 4) * 100 * weight;
    weights += weight;
  }
  if (weights === 0) return 0;
  return Math.round((total / weights) * 100) / 100;
}
