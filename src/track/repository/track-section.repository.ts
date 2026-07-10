import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackSection } from '../entity/track-section.entity';

@Injectable()
export class TrackSectionRepository extends Repository<TrackSection> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackSection, dataSource.createEntityManager());
  }

  async findByTrackId(trackId: string): Promise<TrackSection[]> {
    return this.find({ where: { trackId }, order: { order: 'ASC' } });
  }
}
