import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackEnrollment } from '../entity/track-enrollment.entity';

@Injectable()
export class TrackEnrollmentRepository extends Repository<TrackEnrollment> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackEnrollment, dataSource.createEntityManager());
  }

  async findByTrackAndUser(
    trackId: string,
    userId: number,
  ): Promise<TrackEnrollment | null> {
    return this.findOne({ where: { trackId, userId } });
  }

  async existsForTrack(trackId: string): Promise<boolean> {
    const enrollment = await this.findOne({ where: { trackId } });
    return !!enrollment;
  }
}
