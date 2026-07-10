import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackItem } from '../entity/track-item.entity';

@Injectable()
export class TrackItemRepository extends Repository<TrackItem> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackItem, dataSource.createEntityManager());
  }

  async findByTrackId(trackId: string): Promise<TrackItem[]> {
    return this.find({ where: { trackId }, order: { order: 'ASC' } });
  }
}
