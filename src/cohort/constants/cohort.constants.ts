/**
 * The wire sentinel for the "Unassigned" audience — users of the tenant who are
 * in no cohort.
 *
 * In the database that audience is a NULL `cohortId` (see the
 * CreateTenantCohorts migration header for why it is NULL rather than a system
 * cohort row per tenant). NULL is a poor value to move across an HTTP boundary
 * and into a React key or a <select> value, so every DTO uses this string
 * instead and the service layer is the only place that knows the two are the
 * same thing.
 */
export const UNASSIGNED_COHORT_ID = 'unassigned';

/**
 * Label shown wherever the Unassigned bucket appears in a cohort list. Kept
 * here, next to the sentinel, so the backend's synthesised row and any frontend
 * fallback cannot drift into calling the same audience two different things.
 */
export const UNASSIGNED_COHORT_NAME = 'Unassigned';

/** The content families that can carry a cohort restriction. */
export enum CohortContentType {
  SCENARIO = 'scenario',
  TRACK = 'track',
  CASE = 'case',
}

/**
 * Per-content-type wiring for the three restriction tables. The tables are
 * structurally identical apart from the content-id column, so the read-path
 * query helper and the restriction service both drive off this map rather than
 * switching on the enum in five places.
 *
 * `idIsUuid` exists because `scenarios.id` is an integer while `tracks.id` and
 * `cases.id` are uuids — the restriction service needs it to validate an
 * incoming content id before it reaches SQL.
 */
export const COHORT_CONTENT_CONFIG: Record<
  CohortContentType,
  { table: string; column: string; idIsUuid: boolean }
> = {
  [CohortContentType.SCENARIO]: {
    table: 'scenario_cohort_restrictions',
    column: 'scenarioId',
    idIsUuid: false,
  },
  [CohortContentType.TRACK]: {
    table: 'track_cohort_restrictions',
    column: 'trackId',
    idIsUuid: true,
  },
  [CohortContentType.CASE]: {
    table: 'case_cohort_restrictions',
    column: 'caseId',
    idIsUuid: true,
  },
};
