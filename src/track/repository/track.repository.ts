import {
  applyCohortVisibilityFilter,
  TRACK_ENROLMENT_GRACE_SQL,
} from 'src/cohort/query/cohort-restriction.query';
import { CohortContentType } from 'src/cohort/constants/cohort.constants';
import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Track } from '../entity/track.entity';
import {
  TrackFilterOptions,
  TrackItemType,
  TrackSortBy,
  TrackStatus,
} from '../type/track.type';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { TrackItem } from '../entity/track-item.entity';
import { AssignmentStatus } from 'src/common/type/common.type';

export interface TrackWithEnrollment extends Track {
  enrollment?: TrackEnrollment;
  /**
   * ROLEPLAY items only, computed live — distinct from `totalItems`, which
   * counts every section item (quizzes, videos, annotations included). This
   * is what a course card's "N simulations" label should read.
   */
  simulationsCount: number;
}

@Injectable()
export class TrackRepository extends Repository<Track> {
  constructor(private dataSource: DataSource) {
    super(Track, dataSource.createEntityManager());
  }

  async getAllTracks(filters?: TrackFilterOptions): Promise<{
    data: (Track & { trackTenant?: unknown })[];
    count: number;
  }> {
    const query = this.createQueryBuilder('track');

    if (filters?.tenantId) {
      query
        .leftJoinAndMapOne(
          'track.trackTenant',
          'track_tenants',
          'trackTenant',
          '"trackTenant"."trackId" = track.id AND "trackTenant"."tenantId" = :tenantId AND "trackTenant"."deletedAt" IS NULL',
        )
        .setParameters({ tenantId: filters.tenantId });

      if (filters.assignmentStatus === AssignmentStatus.ASSIGNED) {
        query.andWhere('"trackTenant"."id" IS NOT NULL');
      } else if (filters.assignmentStatus === AssignmentStatus.UNASSIGNED) {
        query.andWhere('"trackTenant"."id" IS NULL');
      }
    }

    if (filters?.status) {
      query.andWhere('track.status IN (:...status)', {
        status: filters.status,
      });
    }
    this.applySearchFilter(query, filters);

    if (filters?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(filters.sortBy);
      if (sortColumn) {
        query.orderBy(`track.${sortColumn}`, filters.order as 'ASC' | 'DESC');
      }
    }

    if (filters?.limit) {
      query.limit(filters.limit);
    }
    if (filters?.offset) {
      query.offset(filters.offset);
    }

    const [data, count] = await query.getManyAndCount();
    return { data, count };
  }

  /**
   * ACTIVE tracks visible to the tenant, with the requesting user's
   * enrollment (if any) mapped onto each row.
   */
  async getTracksForLearner(options: {
    userId: number;
    tenantId?: string;
    limit?: number;
    offset?: number;
    /**
     * Apply the requester's cohort restrictions. `cohortId: null` is the
     * "Unassigned" audience, not "no filtering" — pass the object or nothing.
     */
    cohortScope?: { cohortId: string | null };
  }): Promise<{ data: TrackWithEnrollment[]; count: number }> {
    const query = this.createQueryBuilder('track')
      .leftJoinAndMapOne(
        'track.enrollment',
        TrackEnrollment,
        'enrollment',
        '"enrollment"."trackId" = track.id AND enrollment.userId = :userId AND "enrollment"."deletedAt" IS NULL',
      )
      .addSelect((subQuery) => {
        return subQuery
          .select('COUNT(*)')
          .from(TrackItem, 'trackItem')
          .where('"trackItem"."trackId" = track.id')
          .andWhere(`"trackItem"."type" = '${TrackItemType.ROLEPLAY}'`)
          .andWhere('"trackItem"."deletedAt" IS NULL');
      }, 'simulationsCount')
      .setParameters({ userId: options.userId })
      .where('track.status = :status', { status: TrackStatus.ACTIVE });

    if (options.tenantId) {
      query
        .innerJoin(
          'track_tenants',
          'trackTenant',
          '"trackTenant"."trackId" = track.id AND trackTenant.tenantId = :tenantId AND "trackTenant"."deletedAt" IS NULL',
        )
        .setParameters({ tenantId: options.tenantId });
    }

    // Cohort narrowing, layer 2 on top of the track_tenants join above, plus the
    // "finish what you started" grace: a learner with a live enrolment keeps the
    // course even after their cohort loses browse access. Requires tenantId —
    // restrictions are per tenant, so there is nothing to apply without one.
    if (options.cohortScope && options.tenantId) {
      applyCohortVisibilityFilter(query, {
        alias: 'track',
        contentType: CohortContentType.TRACK,
        tenantId: options.tenantId,
        cohortId: options.cohortScope.cohortId,
        graceExistsSql: TRACK_ENROLMENT_GRACE_SQL,
      });
    }

    query.orderBy('enrollment.lastActivityAt', 'DESC', 'NULLS LAST');
    query.addOrderBy('track.updatedAt', 'DESC');

    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }

    // `addSelect`'s scalar subquery isn't a mapped relation, so it doesn't
    // come back on the hydrated entities from `getMany()` — pull it from the
    // parallel raw rows instead. `getCount()` re-derives its own COUNT(1)
    // query from the same builder, so this is still the usual two queries
    // getManyAndCount() would have run, not an extra one.
    const [{ entities, raw }, count] = await Promise.all([
      query.getRawAndEntities<{ simulationsCount: string }>(),
      query.getCount(),
    ]);
    const data = entities.map((track, index) => ({
      ...track,
      simulationsCount: parseInt(raw[index]?.simulationsCount ?? '0', 10),
    }));
    return { data: data as TrackWithEnrollment[], count };
  }

  private applySearchFilter(
    query: SelectQueryBuilder<Track>,
    filters?: TrackFilterOptions,
  ): void {
    if (filters?.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      query.andWhere('(track.title ILIKE :search)', { search: searchTerm });
    }
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return null;
    }
    const validColumns = Object.values(TrackSortBy);
    return validColumns.includes(sortBy as TrackSortBy) ? sortBy : null;
  }
}
