import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackAnnotationAttempt } from '../entity/track-annotation-attempt.entity';

@Injectable()
export class TrackAnnotationAttemptRepository extends Repository<TrackAnnotationAttempt> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackAnnotationAttempt, dataSource.createEntityManager());
  }

  async countByProgressId(trackItemProgressId: string): Promise<number> {
    return this.count({ where: { trackItemProgressId } });
  }

  /** Most recent attempt, used to re-render a completed item read-only. */
  async findLatestByProgressId(
    trackItemProgressId: string,
  ): Promise<TrackAnnotationAttempt | null> {
    return this.findOne({
      where: { trackItemProgressId },
      order: { attemptNumber: 'DESC' },
    });
  }
}
