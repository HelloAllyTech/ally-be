import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ScenarioSessionEventStatus } from '../../learn/enum/scenario-session-status.enum';
import { AnalyticsBucket } from './platform-analytics.repository';

export interface BucketCountRow {
  /** Bucket start as a calendar date string (yyyy-mm-dd). */
  bucket: string;
  count: number;
}

/**
 * Tenant-scoped organization-metrics queries for the tenant-admin dashboard.
 * Mirrors the conventions of PlatformAnalyticsRepository (raw counts, dates as
 * yyyy-mm-dd strings, shaping done in the service) with one difference: every
 * query filters on `tenant_id`, so a tenant admin only ever sees their own
 * organization.
 *
 * "Completed simulation" follows the platform convention:
 * `eventStatus = COMPLETED`, timestamped by `COALESCE(endedAt, createdAt)`.
 * "Active user" is spec-defined for this dashboard as a user with >=1
 * COMPLETED simulation in the window (stricter than the platform overview's
 * any-activity definition).
 */
@Injectable()
export class TenantAnalyticsRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Simulations completed by the tenant's users within [start, end). */
  async getCompletedSimulationCount(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /**
   * Distinct tenant users with at least one completed simulation within
   * [start, end).
   */
  async getActiveUserCount(
    tenantId: string,
    start: Date,
    end: Date,
  ): Promise<number> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .getRawOne<{ count: number }>();

    return Number(row?.count) || 0;
  }

  /** Completed simulations grouped by bucket within [start, end). */
  async getCompletedSimulationsByBucket(
    tenantId: string,
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${bucket}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(*)::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }

  /**
   * Distinct users with >=1 completed simulation, grouped by bucket within
   * [start, end).
   */
  async getActiveUsersByBucket(
    tenantId: string,
    start: Date,
    end: Date,
    bucket: AnalyticsBucket,
  ): Promise<BucketCountRow[]> {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(
        `to_char(date_trunc('${bucket}', COALESCE(s."endedAt", s."createdAt")), 'YYYY-MM-DD')`,
        'bucket',
      )
      .addSelect('COUNT(DISTINCT s."counselorId")::int', 'count')
      .from('scenario_sessions', 's')
      .where('s."tenant_id" = :tenantId', { tenantId })
      .andWhere('s."eventStatus" = :completed', {
        completed: ScenarioSessionEventStatus.COMPLETED,
      })
      .andWhere('COALESCE(s."endedAt", s."createdAt") >= :start', { start })
      .andWhere('COALESCE(s."endedAt", s."createdAt") < :end', { end })
      .groupBy('bucket')
      .orderBy('bucket', 'ASC')
      .getRawMany<{ bucket: string; count: number }>();

    return rows.map((r) => ({
      bucket: r.bucket,
      count: Number(r.count) || 0,
    }));
  }
}
