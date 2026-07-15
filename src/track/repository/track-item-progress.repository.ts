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
}
