import { TrackItemType } from '../type/track.type';

/**
 * Trigger warnings per section of one course, in a single round trip. `$1` is
 * the track id.
 *
 * The warnings live on scenarios, so the query first resolves every scenario
 * behind the course's items: a ROLEPLAY item points at one directly, a CASE
 * item at a sequence of them through `case_items`. Returns one row per
 * (section, warning) with the English name and the `translations` jsonb, so the
 * caller can localise without a second query.
 *
 * Shared by the public outline (`TrackEnrollmentService`) and the Course
 * Copilot landing-page draft, which must agree on what the course carries.
 * `$1` is cast at both uses: Postgres infers a parameter's type from the first
 * place it appears and rejects a reuse that implies another.
 */
export const TRACK_TRIGGER_WARNINGS_BY_SECTION_SQL = `
  WITH item_scenarios AS (
    SELECT ti."trackSectionId" AS "sectionId", ti."scenarioId" AS "scenarioId"
    FROM "track_items" ti
    WHERE ti."trackId" = $1::uuid
      AND ti."deletedAt" IS NULL
      AND ti."type" = '${TrackItemType.ROLEPLAY}'
      AND ti."scenarioId" IS NOT NULL
    UNION ALL
    SELECT ti."trackSectionId", ci."scenarioId"
    FROM "track_items" ti
    JOIN "case_items" ci
      ON ci."caseId" = ti."caseId" AND ci."deletedAt" IS NULL
    WHERE ti."trackId" = $1::uuid
      AND ti."deletedAt" IS NULL
      AND ti."type" = '${TrackItemType.CASE}'
  )
  SELECT s."sectionId" AS "sectionId",
         tw."name" AS "name",
         tw."translations" AS "translations"
  FROM item_scenarios s
  JOIN "scenario_trigger_warnings" stw ON stw."scenarioId" = s."scenarioId"
  JOIN "trigger_warnings" tw ON tw."id" = stw."triggerWarningId"
`;

/** One row of {@link TRACK_TRIGGER_WARNINGS_BY_SECTION_SQL}. */
export interface TrackSectionTriggerWarningRow {
  sectionId: string;
  name: string;
  translations: unknown;
}
