import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import {
  CohortContentType,
  COHORT_CONTENT_CONFIG,
} from '../constants/cohort.constants';

export interface CohortVisibilityOptions {
  /** QueryBuilder alias of the content table being filtered (e.g. 'scenario'). */
  alias: string;
  /** Primary-key column on that alias. Defaults to 'id'. */
  aliasIdColumn?: string;
  contentType: CohortContentType;
  /** Tenant whose restrictions apply — the requester's own tenant. */
  tenantId: string;
  /**
   * The requester's cohort, or `null` when they are in no cohort (the
   * "Unassigned" audience, stored as a NULL `cohortId` on the restriction row).
   */
  cohortId: string | null;
  /**
   * Optional SQL for an EXISTS that re-admits content the requester has already
   * started, implementing the "finish what you started, no new starts" rule.
   * Interpolated raw, so it must be a literal owned by the calling repository —
   * never anything derived from request input. Any bind parameters it references
   * must already be set on the query.
   */
  graceExistsSql?: string;
  /**
   * Suffix that keeps bind-parameter names unique when a query applies this
   * filter more than once. Must be alphanumeric.
   */
  paramSuffix?: string;
}

/**
 * Adds the cohort-visibility predicate to a learner-facing content query.
 *
 * The predicate encodes the whole product rule in one place:
 *
 *   visible  =  has no restriction at all          (the default — tenant-wide)
 *            OR one of its restrictions is mine    (explicitly targeted)
 *            OR I already started it               (the grace rule, optional)
 *
 * The first branch is why deploying cohorts changes nothing for a tenant that
 * never uses them, and why no backfill was needed: an item with zero rows in
 * the restriction table stays visible to everyone, exactly as before.
 *
 * `NOT EXISTS ... OR EXISTS ...` rather than a LEFT JOIN with a GROUP BY,
 * because these run inside `getManyAndCount()` queries that already carry
 * leftJoinAndMapOne relations (enrollment, session). Adding a joined row
 * multiplier there would corrupt the count and the mapped relations; a
 * correlated subquery cannot.
 *
 * Both subqueries are covered by the `<table>_lookup_idx` partial index on
 * ("tenantId", "<content>") created alongside the tables.
 */
export function applyCohortVisibilityFilter<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  options: CohortVisibilityOptions,
): SelectQueryBuilder<T> {
  const {
    alias,
    aliasIdColumn = 'id',
    contentType,
    tenantId,
    cohortId,
    graceExistsSql,
    paramSuffix = '',
  } = options;

  if (paramSuffix && !/^[A-Za-z0-9]+$/.test(paramSuffix)) {
    throw new Error(
      `applyCohortVisibilityFilter: paramSuffix must be alphanumeric, got "${paramSuffix}"`,
    );
  }

  const { table, column } = COHORT_CONTENT_CONFIG[contentType];
  const tenantParam = `cohortTenantId${paramSuffix}`;
  const cohortParam = `cohortId${paramSuffix}`;
  // Alias the correlated subqueries distinctly per application so two filters on
  // one query cannot shadow each other.
  const sub = `cr${paramSuffix || '0'}`;

  const scopeSql = `
    "${sub}"."${column}" = "${alias}"."${aliasIdColumn}"
    AND "${sub}"."tenantId" = :${tenantParam}
    AND "${sub}"."deletedAt" IS NULL`;

  // Branch on null rather than using `IS NOT DISTINCT FROM :param`: binding SQL
  // NULL through a driver parameter to a uuid column is needlessly fragile when
  // the two cases are known at build time.
  const mineSql = cohortId
    ? `AND "${sub}"."cohortId" = :${cohortParam}`
    : `AND "${sub}"."cohortId" IS NULL`;

  const branches = [
    `NOT EXISTS (SELECT 1 FROM "${table}" "${sub}" WHERE ${scopeSql})`,
    `EXISTS (SELECT 1 FROM "${table}" "${sub}" WHERE ${scopeSql} ${mineSql})`,
  ];
  if (graceExistsSql) {
    branches.push(graceExistsSql);
  }

  query.andWhere(`(${branches.join(' OR ')})`);
  query.setParameter(tenantParam, tenantId);
  if (cohortId) {
    query.setParameter(cohortParam, cohortId);
  }

  return query;
}

/**
 * "Finish what you started" for courses: a live enrolment keeps the course
 * reachable even once the learner's cohort loses browse access.
 *
 * Any live enrolment counts, not only one with `startedAt` set — enrolling is a
 * deliberate act and an enrolled-but-unopened course already shows in the
 * learner's list, so treating it as not-yet-started would make a course they
 * chose vanish between two visits.
 *
 * Expects `:userId` to be bound on the query already (every learner query here
 * binds it for the enrolment/session join).
 */
export const TRACK_ENROLMENT_GRACE_SQL = `EXISTS (
  SELECT 1 FROM "track_enrollments" "grace_te"
   WHERE "grace_te"."trackId" = "track"."id"
     AND "grace_te"."userId" = :userId
     AND "grace_te"."deletedAt" IS NULL
)`;

/**
 * "Finish what you started" for cases: an actually-started case session keeps
 * the case reachable.
 *
 * Stricter than the course rule on purpose — a `case_sessions` row is created by
 * the act of opening the case, so requiring `startedAt` here is what
 * distinguishes real progress from a stray row.
 */
export const CASE_SESSION_GRACE_SQL = `EXISTS (
  SELECT 1 FROM "case_sessions" "grace_cs"
   WHERE "grace_cs"."caseId" = "case"."id"
     AND "grace_cs"."userId" = :userId
     AND "grace_cs"."startedAt" IS NOT NULL
     AND "grace_cs"."deletedAt" IS NULL
)`;
