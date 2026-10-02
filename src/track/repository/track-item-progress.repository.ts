import { SessionItemStatus } from 'src/common/type/common.type';
import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackItemProgress } from '../entity/track-item-progress.entity';

@Injectable()
export class TrackItemProgressRepository extends Repository<TrackItemProgress> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackItemProgress, dataSource.createEntityManager());
  }

  async findByEnrollmentId(
    trackEnrollmentId: string,
  ): Promise<TrackItemProgress[]> {
    return this.find({ where: { trackEnrollmentId } });
  }

  async countUsersCompletedByTrackItem(trackItemId: string): Promise<number> {
    const result = await this.createQueryBuilder('tip')
      .select('COUNT(DISTINCT tip.userId)', 'count')
      .where('tip.trackItemId = :trackItemId', { trackItemId })
      .andWhere('tip.status = :status', {
        status: SessionItemStatus.COMPLETED,
      })
      .getRawOne();
    return parseInt(result?.count ?? '0', 10);
  }
}
