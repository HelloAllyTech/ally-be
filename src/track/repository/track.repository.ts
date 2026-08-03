import { Injectable } from '@nestjs/common';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { Track } from '../entity/track.entity';
import {
  TrackFilterOptions,
  TrackSortBy,
  TrackStatus,
} from '../type/track.type';
import { TrackEnrollment } from '../entity/track-enrollment.entity';
import { AssignmentStatus } from 'src/common/type/common.type';

export interface TrackWithEnrollment extends Track {
  enrollment?: TrackEnrollment;
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
  }): Promise<{ data: TrackWithEnrollment[]; count: number }> {
    const query = this.createQueryBuilder('track')
      .leftJoinAndMapOne(
        'track.enrollment',
        TrackEnrollment,
        'enrollment',
        '"enrollment"."trackId" = track.id AND enrollment.userId = :userId AND "enrollment"."deletedAt" IS NULL',
      )
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

    query.orderBy('enrollment.lastActivityAt', 'DESC', 'NULLS LAST');
    query.addOrderBy('track.updatedAt', 'DESC');

    if (options.limit) {
      query.limit(options.limit);
    }
    if (options.offset) {
      query.offset(options.offset);
    }

    const [data, count] = await query.getManyAndCount();
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
