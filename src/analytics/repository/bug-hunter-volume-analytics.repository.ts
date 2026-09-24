import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  BugFindingSource,
  BugFindingStatus,
} from 'src/bug-hunter/enum/bug-finding.enum';
import { BugHuntEventStage } from 'src/bug-hunter/enum/bug-hunt-event.enum';
import { AnalyticsBucket } from './platform-analytics.repository';

/**
 * Statuses that mean "fixed" for this chart: merged to master, regardless of
 * how the release afterwards went. A release failing after merge does not
 * un-fix the bug — the merge is what "fixed" means here — so everything
 * downstream of MERGED counts too.
 */
export const BUG_HUNTER_FIXED_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASING,
  BugFindingStatus.RELEASED,
  BugFindingStatus.RELEASE_FAILED,
];

/** One bucket of the found-vs-fixed series. */
export interface BugHunterVolumeBucketRow {
  bucket: string;
  count: number;
}

/**
 * Bug Hunter's found vs. fixed volume, read directly off `bug_findings` (plus
 * `bug_hunt_events` for the fixed timestamp — see below) by table name via
 * `DataSource.createQueryBuilder()`, rather than adding a method to
 * `BugFindingRepository`: that file is under concurrent edit by another
 * session at the time this was written, and every query this chart needs is a
 * simple bucketed count with no reason to live behind the bug-hunter module's
 * own repository.
 *
 * "Found" is bucketed by `createdAt` (when the finding was first filed) and
 * counts every source except `REPORTED_BUG` — a human-filed bug via "Report a
 * bug" was not "automatically found" by Bug Hunter, regardless of who later
 * fixed it.
 *
 * "Fixed" is bucketed by the finding's MERGED transition — `bug_hunt_events`
 * has a `MERGED` stage row, written the moment a finding's fix session lands on
 * master (see `BugHuntEventStage.MERGED`), which is exactly what "fixed"
 * should be timestamped against rather than the coarser `decidedAt` (a human's
 * approve/reject decision, not the fix landing). Findings that reached a fixed
 * status before that event existed, or through a path that never wrote one,
 * fall back to `decidedAt` — with the caveat that a `decidedAt` fallback marks
 * DECISION time, not merge time, so a bucket built partly from fallback rows is
 * a few days coarser than one built entirely from merge events. In practice
 * this only matters for the small number of pre-instrumentation rows; every
 * finding merged going forward carries a real `MERGED` event.
 *
 * `bug_findings` carries no tenant column — it is Ally's own internal bug
 * tracker, not tenant data — so there is no `excludeTestTenants` predicate and
 * no tenant parameter anywhere in this file.
 */
@Injectable()
export class BugHunterVolumeAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where this chart's data begins — the earliest `bug_findings` row. Unlike
   * `getPlatformDataFloor` (users/scenario_sessions), this table has its own,
   * unrelated start date: Bug Hunter's own first recorded finding, whenever
   * that table started being written to.
   */
  async getDataFloor(): Promise<Date> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select('MIN(bf."createdAt")', 'floor')
      .from('bug_findings', 'bf')
      .getRawOne<{ floor: Date | string | null }>();

    if (!rows?.floor) return new Date();
    const parsed =
      rows.floor instanceof Date ? rows.floor : new Date(rows.floor);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  /** Findings autonomously discovered by Bug Hunter, bucketed by when they were filed. */
  async getFoundByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BugHunterVolumeBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', bf."createdAt"), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('bug_findings', 'bf')
      .where('bf."createdAt" >= :start', { start })
      .andWhere('bf."createdAt" < :end', { end })
      .andWhere('bf."source" != :reportedBug', {
        reportedBug: BugFindingSource.REPORTED_BUG,
      })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: string | number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Findings currently merged (or past that, per {@link BUG_HUNTER_FIXED_STATUSES}),
   * bucketed by the merge event's timestamp where one exists, else `decidedAt`.
   */
  async getFixedByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BugHunterVolumeBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(me."mergedAt", bf."decided_at")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('bug_findings', 'bf')
      .leftJoin(
        (subQuery) =>
          subQuery
            .select('e."finding_id"', 'findingId')
            // MIN, not MAX: a finding merges to master at most once on the
            // main pipeline — a regression opens a NEW finding row rather than
            // re-transitioning this one — so MIN/MAX would agree in practice;
            // MIN is the more conservative, deterministic pick if that ever
            // changes.
            .addSelect('MIN(e."createdAt")', 'mergedAt')
            .from('bug_hunt_events', 'e')
            .where('e."stage" = :mergedStage', {
              mergedStage: BugHuntEventStage.MERGED,
            })
            .groupBy('e."finding_id"'),
        'me',
        'me."findingId" = bf."id"',
      )
      .where('bf."status" IN (:...statuses)', {
        statuses: BUG_HUNTER_FIXED_STATUSES,
      })
      .andWhere('COALESCE(me."mergedAt", bf."decided_at") >= :start', { start })
      .andWhere('COALESCE(me."mergedAt", bf."decided_at") < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: string | number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }
}
