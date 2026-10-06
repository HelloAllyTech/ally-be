import { FhsAssessmentStatus } from '../enum/foundational-skills.enum';
import { fhsEligibleSession } from './fhs-eligible-session.util';

/*
 * SQL fragments of the feedback -> skill mapping's population, shared by the
 * scheduler's queue (FeedbackSkillMappingRepository) and the analytics
 * coverage count (FeedbackUptakeAnalyticsRepository), so "pending" on the
 * chart can never disagree with what the scheduler will pick up.
 */

/**
 * SQL: how many improvement items the debrief in `scenario_session_details`
 * row `alias` carries — `summary.feedback.areasOfGrowth`, else the legacy
 * `summary.feedback.improvements` (see `debriefImprovements`). 0 when neither
 * is an array.
 *
 * Every length is taken inside its own CASE, never as
 * `jsonb_typeof(x) = 'array' AND jsonb_array_length(x) > 0`: Postgres does not
 * promise to evaluate an AND left to right, and `jsonb_array_length` on a
 * scalar throws, which would stop the whole query for one odd row. CASE does
 * evaluate in order.
 */
export const debriefItemCountSql = (alias: string): string => {
  const length = (path: string) =>
    `(CASE WHEN jsonb_typeof(${path}) = 'array' THEN jsonb_array_length(${path}) ELSE 0 END)`;
  const current = length(`${alias}.summary->'feedback'->'areasOfGrowth'`);
  const legacy = length(`${alias}.summary->'feedback'->'improvements'`);
  return `(CASE WHEN ${current} > 0 THEN ${current} ELSE ${legacy} END)`;
};

/**
 * SQL: the learner `userCol` has at least one scored cut under
 * `rubricParam`. The mapping's population — only such learners can ever have
 * a cut either side of a session, so mapping anyone else's debriefs would be
 * spend the chart can never use.
 */
export const hasScoredCutSql = (userCol: string, rubricParam: string): string =>
  `EXISTS (SELECT 1 FROM foundational_skill_cuts fsc ` +
  `JOIN foundational_skill_assessments fsa ON fsa."cutId" = fsc.id ` +
  `WHERE fsc."userId" = ${userCol} AND fsa."rubricVersion" = ${rubricParam} ` +
  `AND fsa.status = '${FhsAssessmentStatus.SCORED}' AND fsa."compositeScore" IS NOT NULL)`;

/**
 * SQL: the session `s` (with its `scenario_session_details` row `d`) is one
 * the mapping covers — FHS-eligible (ended and completed, settled, a countable
 * room, not an AI-vs-AI test, not a test organisation), a debrief with at least
 * one improvement item, and a learner with a scored cut under `rubricParam`.
 */
export const feedbackMappingPopulationSql = (
  sessionAlias: string,
  detailsAlias: string,
  rubricParam: string,
): string =>
  [
    fhsEligibleSession(sessionAlias),
    `${debriefItemCountSql(detailsAlias)} > 0`,
    hasScoredCutSql(`${sessionAlias}."counselorId"`, rubricParam),
  ].join(' AND ');
