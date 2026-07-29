import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SessionItemStatus } from '../../common/type/common.type';
import {
  excludeTestTenantsByUser,
  scopeToTenantByUser,
} from '../util/test-tenant.util';
import { MIN_COHORT_SIZE } from './cohort-analytics.repository';

/** Completion of one item FORMAT across every track in scope. */
export interface TrackDropoffItemTypeRow {
  /** `TrackItemType` value as stored. */
  type: string;
  /** Progress rows the learner could actually get to (status <> LOCKED). */
  reached: number;
  /** Of those, rows at status COMPLETED. */
  completed: number;
  /** Distinct learners who reached at least one item of this format. */
  learners: number;
}

/** Completion of one SECTION of one track. */
export interface TrackDropoffSectionRow {
  trackId: string;
  trackTitle: string;
  sectionId: string;
  sectionTitle: string;
  /** The section's position within its track. */
  order: number;
  reached: number;
  completed: number;
  /**
   * Distinct learners who reached the section. Carried so the service can apply
   * the group-size floor; deliberately NOT part of the API response — see
   * {@link TrackDropoffSectionDto.belowFloor}.
   */
  learners: number;
}

/** What the breakdowns are breakdowns of. */
export interface TrackDropoffSummaryRow {
  enrollments: number;
  learners: number;
  itemsTracked: number;
  completedEnrollments: number;
}

/**
 * Smallest learner group a completion RATE may be stated for.
 *
 * Imported from {@link MIN_COHORT_SIZE} rather than redeclared: one floor across
 * cohort retention, usage levels, roleplay volume, org health and this endpoint
 * is one number people can hold in their head, and a second copy is a second
 * chance for the surfaces to disagree about what "too small to state" means.
 */
export const MIN_TRACK_GROUP_SIZE = MIN_COHORT_SIZE;

/**
 * All-time completion of track items — "which item format kills momentum?" — for
 * the leadership Highlights tab.
 *
 * The question: a learner enrolls in a track and walks a sequence of items of six
 * different formats. Where do they stop, and is it a property of the FORMAT (a
 * quiz nobody passes, a video nobody opens) or of one particular section of one
 * particular curriculum? The track funnel on the Highlights tab counts
 * enrolled → started → completed and cannot see inside the track; this is what
 * happens between the second and third bar.
 *
 * The measurement that makes this honest is `reached`. `track_item_progress` rows
 * are created for the WHOLE track at enrollment time — the first item UNLOCKED,
 * every other one LOCKED — so a raw row count per format reports how many items
 * of that format the authors wrote, not how many learners got to one. Only rows
 * that have left LOCKED are evidence that a learner could act, so `reached` is
 * `status <> LOCKED` and every rate on this endpoint is over it. COMPLETED
 * implies not-LOCKED, so `completed <= reached` holds by construction rather than
 * by hope.
 *
 * ALL-TIME by design (no `range`/`bucket`): reaching an item and completing it can
 * be months apart, and any window narrow enough to be interesting would count one
 * end of that pair and not the other.
 *
 * `track_item_progress` and `track_items` carry NO tenant column (both extend
 * `BaseWithoutTenantEntity`), so both the test-org exclusion and the org
 * narrowing walk the owning learner — the same route
 * {@link HighlightsAnalyticsRepository.getQuizPassCounts} takes for
 * `track_quiz_attempts`. Reaching the tenant two different ways for the two
 * predicates is how a filtered numerator ends up over an unfiltered denominator.
 *
 * Conventions follow the sibling repositories: `DataSource` raw SQL over tables
 * BY NAME (no entity repos), quoted camelCase identifiers, counts `::int` and
 * re-parsed defensively in JS.
 */
@Injectable()
export class TrackDropoffAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * The predicates every query here shares, plus the params they bind.
   *
   * Returned as one object so a call site cannot pick up the LOCKED/COMPLETED
   * status values without also picking up the tenant predicates: the statuses
   * define what "reached" means and the tenant predicates define whose data it
   * means it over, and the two have to travel together.
   *
   * `$1` is always LOCKED and `$2` always COMPLETED; the tenant, when present, is
   * `$3`. Bound parameters throughout — the enum values are ours, but a value
   * interpolated "because it is ours" is the habit that eventually interpolates
   * one that is not.
   */
  private scope(
    userIdColumn: string,
    tenantId?: string,
  ): { params: unknown[]; predicate: string } {
    const params: unknown[] = [
      SessionItemStatus.LOCKED,
      SessionItemStatus.COMPLETED,
    ];
    let predicate = excludeTestTenantsByUser(userIdColumn);
    if (tenantId) {
      params.push(tenantId);
      predicate += ` AND ${scopeToTenantByUser(userIdColumn, `$${params.length}`)}`;
    }
    return { params, predicate };
  }

  /**
   * Completion per item format.
   *
   * Only formats that HAVE progress rows come back. The service pads the list out
   * to the full enum so a format nobody has reached still occupies its place in
   * the category order rather than silently leaving the axis.
   *
   * `learners` is counted over the reached rows, not over all rows: the floor this
   * feeds asks "how many people is this rate a statement about", and a learner
   * whose journal is still locked is not one of them.
   */
  async getItemTypeProgress(
    tenantId?: string,
  ): Promise<TrackDropoffItemTypeRow[]> {
    const { params, predicate } = this.scope('p."userId"', tenantId);

    const rows = await this.dataSource.query(
      `
      SELECT
        i."type"                                                  AS "type",
        COUNT(*) FILTER (WHERE p."status" <> $1)::int             AS "reached",
        COUNT(*) FILTER (WHERE p."status" = $2)::int              AS "completed",
        COUNT(DISTINCT p."userId")
          FILTER (WHERE p."status" <> $1)::int                    AS "learners"
      FROM track_item_progress p
      JOIN track_items i ON i.id = p."trackItemId" AND i."deletedAt" IS NULL
      WHERE p."deletedAt" IS NULL
        AND ${predicate}
      GROUP BY i."type"
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      type: String(r.type),
      reached: Number(r.reached) || 0,
      completed: Number(r.completed) || 0,
      learners: Number(r.learners) || 0,
    }));
  }

  /**
   * Completion per section, with the track it belongs to.
   *
   * Ordered by track title then section `order` — the sequence the learner walks.
   * A drop-off is only visible along the curriculum's own axis; sorting these by
   * completion rate would produce a ranked list in which the shape of the fall
   * cannot be seen at all.
   *
   * `tracks` is LEFT joined and its title coalesced to the id: a section whose
   * track has since been soft-deleted still holds real learner progress, and
   * dropping those rows would quietly shrink the totals the format breakdown is
   * reconciled against.
   */
  async getSectionProgress(
    tenantId?: string,
  ): Promise<TrackDropoffSectionRow[]> {
    const { params, predicate } = this.scope('p."userId"', tenantId);

    const rows = await this.dataSource.query(
      `
      SELECT
        sec."trackId"::text                                       AS "trackId",
        COALESCE(t.title, sec."trackId"::text)                    AS "trackTitle",
        sec.id::text                                              AS "sectionId",
        sec.title                                                 AS "sectionTitle",
        sec."order"::int                                          AS "order",
        COUNT(*) FILTER (WHERE p."status" <> $1)::int             AS "reached",
        COUNT(*) FILTER (WHERE p."status" = $2)::int              AS "completed",
        COUNT(DISTINCT p."userId")
          FILTER (WHERE p."status" <> $1)::int                    AS "learners"
      FROM track_item_progress p
      JOIN track_items i   ON i.id = p."trackItemId" AND i."deletedAt" IS NULL
      JOIN track_sections sec
                           ON sec.id = i."trackSectionId" AND sec."deletedAt" IS NULL
      LEFT JOIN tracks t   ON t.id = sec."trackId"
      WHERE p."deletedAt" IS NULL
        AND ${predicate}
      GROUP BY sec."trackId", t.title, sec.id, sec.title, sec."order"
      ORDER BY "trackTitle" ASC, sec."order" ASC
      `,
      params,
    );

    return (rows as Record<string, unknown>[]).map((r) => ({
      trackId: String(r.trackId),
      trackTitle: String(r.trackTitle ?? ''),
      sectionId: String(r.sectionId),
      sectionTitle: String(r.sectionTitle ?? ''),
      order: Number(r.order) || 0,
      reached: Number(r.reached) || 0,
      completed: Number(r.completed) || 0,
      learners: Number(r.learners) || 0,
    }));
  }

  /**
   * The population the breakdowns are drawn from.
   *
   * `itemsTracked` counts DISTINCT items that at least one learner reached, not
   * progress rows: it answers "how much of the catalogue does this analysis have
   * evidence about", and an item nobody has unlocked is not evidence of a
   * drop-off in either direction.
   *
   * Both halves are scoped through the owning user, so `enrollments` and the
   * per-format rows describe the same set of people.
   */
  async getSummary(tenantId?: string): Promise<TrackDropoffSummaryRow> {
    // This query needs LOCKED but not COMPLETED, so it binds its own parameters
    // rather than reusing {@link scope}: Postgres rejects a statement carrying a
    // parameter no expression references ("could not determine data type of
    // parameter"), so the placeholder list has to match what the SQL actually
    // asks for.
    const params: unknown[] = [SessionItemStatus.LOCKED];
    if (tenantId) params.push(tenantId);
    const tenantPlaceholder = '$2';

    const enrollmentPredicate = tenantId
      ? `${excludeTestTenantsByUser('e."userId"')} AND ${scopeToTenantByUser(
          'e."userId"',
          tenantPlaceholder,
        )}`
      : excludeTestTenantsByUser('e."userId"');
    // The progress half filters on the same tenant parameter, but through its own
    // table's user column.
    const progressPredicate = tenantId
      ? `${excludeTestTenantsByUser('p."userId"')} AND ${scopeToTenantByUser(
          'p."userId"',
          tenantPlaceholder,
        )}`
      : excludeTestTenantsByUser('p."userId"');

    const rows = await this.dataSource.query(
      `
      WITH scoped_enrollments AS (
        SELECT e."userId", e."completedAt"
        FROM track_enrollments e
        WHERE e."deletedAt" IS NULL
          AND ${enrollmentPredicate}
      ),
      scoped_progress AS (
        SELECT DISTINCT p."trackItemId"
        FROM track_item_progress p
        JOIN track_items i ON i.id = p."trackItemId" AND i."deletedAt" IS NULL
        WHERE p."deletedAt" IS NULL
          AND p."status" <> $1
          AND ${progressPredicate}
      )
      SELECT
        (SELECT COUNT(*)::int FROM scoped_enrollments)              AS "enrollments",
        (SELECT COUNT(DISTINCT "userId")::int
           FROM scoped_enrollments)                                AS "learners",
        (SELECT COUNT(*) FILTER (WHERE "completedAt" IS NOT NULL)::int
           FROM scoped_enrollments)                                AS "completedEnrollments",
        (SELECT COUNT(*)::int FROM scoped_progress)                 AS "itemsTracked"
      `,
      params,
    );

    const r = ((rows as Record<string, unknown>[])[0] ?? {}) as Record<
      string,
      unknown
    >;
    return {
      enrollments: Number(r.enrollments) || 0,
      learners: Number(r.learners) || 0,
      itemsTracked: Number(r.itemsTracked) || 0,
      completedEnrollments: Number(r.completedEnrollments) || 0,
    };
  }
}
