import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { excludeTestTenants, scopeToTenant } from '../util/test-tenant.util';
import { countableSessionPredicate } from '../util/session-eligibility.util';
import { getPlatformDataFloor } from '../util/data-floor.util';
import { AnalyticsBucket } from './platform-analytics.repository';

/** One bucket of the started-vs-completed series. */
export interface CompletionRateBucketRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  /** Countable sessions LAUNCHED in the bucket. */
  started: number;
  /** Of those, the ones that reached COMPLETED — whenever that happened. */
  completed: number;
}

/**
 * Do the simulations learners start actually finish?
 *
 * Every other volume chart on the platform counts completions, which cannot
 * distinguish "fewer people practised" from "the same people kept dropping out
 * half way". This one keeps the denominator: the sessions that were launched.
 *
 * The attribution rule is the whole design, and it is a COHORT rule: both figures
 * are bucketed on when the session was LAUNCHED, and a session launched in
 * January that finished in February is counted as completed in January. The
 * alternative — numerator on completion time, denominator on launch time — mixes
 * two populations, and produces buckets above 100% whenever a backlog clears. The
 * cost of the cohort rule is that the most recent bucket understates completion
 * while its sessions are still running; that bucket is flagged as in-progress in
 * the response, which is the honest way to carry a figure that can only rise.
 *
 * "Launched" is every countable session regardless of status, so an abandonment is
 * a real event with a real cause (the learner left, the agent never joined, the
 * room died) rather than a row that quietly never appears. Preview and seed rooms
 * are excluded by {@link countableSessionPredicate} — a rehearsal that a trainer
 * abandoned on purpose is not a learner giving up.
 *
 * Conventions follow the sibling repositories: `DataSource` query builder over
 * tables BY NAME (no entity repos), quoted camelCase identifiers (only `tenant_id`
 * is snake_case), truncated dates out as `yyyy-mm-dd` strings, counts `::int` and
 * re-parsed defensively.
 */
@Injectable()
export class CompletionRateAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private resolveBucket(bucket: AnalyticsBucket): AnalyticsBucket {
    // Defense-in-depth: bucket is internal, but never interpolate anything we
    // have not explicitly whitelisted.
    if (bucket === 'day') return 'day';
    if (bucket === 'month') return 'month';
    if (bucket === 'year') return 'year';
    return 'week';
  }

  /**
   * Where the platform's data begins — the left edge of an all-time window.
   * See {@link getPlatformDataFloor}. The same measurement every other analytics
   * endpoint uses, so the axes on one tab cover the same period.
   */
  async getDataFloor(): Promise<Date> {
    return getPlatformDataFloor(this.dataSource);
  }

  /**
   * Launches and completions per bucket, both attributed to the launch bucket.
   *
   * Only the two counts come back. The rate is NOT computed here: it is undefined
   * in a bucket with no launches, and SQL would have to choose between a NULL that
   * survives the round trip and a `COALESCE(..., 0)` that fabricates a 0%. The
   * service makes that call once, in one place, where the rule can be stated.
   *
   * Buckets with no launches are ABSENT; the service puts them back on the axis
   * with zero counts and a null rate.
   */
  async getStartedVsCompletedByBucket(
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
    tenantId?: string,
  ): Promise<CompletionRateBucketRow[]> {
    const trunc = this.resolveBucket(bucket);
    const qb = this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${trunc}', COALESCE(s."startedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'started')
      .addSelect(
        'COUNT(*) FILTER (WHERE s."eventStatus" = :completed)::int',
        'completed',
      )
      .from('scenario_sessions', 's')
      .where(countableSessionPredicate('s'))
      .andWhere('COALESCE(s."startedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."startedAt", s."createdAt") < :end', { end })
      .andWhere(excludeTestTenants('s."tenant_id"'))
      .setParameter('completed', ScenarioSessionEventStatus.COMPLETED);
    if (tenantId) {
      qb.andWhere(scopeToTenant('s."tenant_id"', ':tenantId'), { tenantId });
    }
    const rows = await qb
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; started: number; completed: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      started: Number(r.started) || 0,
      completed: Number(r.completed) || 0,
    }));
  }
}
