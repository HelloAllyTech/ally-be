/**
 * The course-progress definitions shared by every surface that reports how far
 * learners get through a Track 2.0 course: the tenant-admin `course-usage`
 * table (TenantAnalyticsRepository.getCourseUsageRows) and the super-admin
 * course funnel (CurriculumAnalyticsRepository.getFunnelEnrollments).
 *
 * One fragment per definition, so "reached half" and "days to complete" cannot
 * mean one thing on the tenant dashboard and another on the platform one.
 * Parameter-free and alias-driven, like the test-tenant predicates, so they
 * drop into any raw query without renumbering placeholders.
 */

/** Share of a course's items an enrolment must have completed to count as "reached half". */
export const COURSE_HALFWAY_SHARE = 0.5;

/**
 * True when the enrolment has completed at least half of the course's items.
 *
 * `track_enrollments.completedItems` is incremented once per item completion
 * (TrackProgressService.completeItem); `tracks.totalItems` is the course's
 * current item count. A course with no items has no half to reach, so it is
 * false rather than a division by zero.
 *
 * `enrollmentAlias` is the track_enrollments alias, `totalItemsExpr` the full
 * expression for the course's item count (e.g. `c."totalItems"`).
 */
export function enrollmentReachedHalfSql(
  enrollmentAlias: string,
  totalItemsExpr: string,
): string {
  return (
    `${totalItemsExpr} > 0 ` +
    `AND ${enrollmentAlias}."completedItems"::float / ${totalItemsExpr} >= ${COURSE_HALFWAY_SHARE}`
  );
}

/**
 * Days from enrolment to completion, fractional. NULL until the enrolment is
 * completed. Enrolling writes `startedAt` (TrackEnrollmentService.enroll), so
 * this is enrol → complete.
 */
export function enrollmentDaysToCompleteSql(enrollmentAlias: string): string {
  return (
    `EXTRACT(EPOCH FROM (${enrollmentAlias}."completedAt" - ` +
    `${enrollmentAlias}."startedAt")) / 86400.0`
  );
}
