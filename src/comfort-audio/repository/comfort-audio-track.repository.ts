import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ComfortAudioTrack } from '../entity/comfort-audio-track.entity';
import {
  ComfortAudioTrackSortBy,
  ComfortAudioTrackSortOrder,
} from '../dto/get-comfort-audio-tracks.dto';
import { GetComfortAudioTracksOptions } from '../type/comfort-audio.type';

@Injectable()
export class ComfortAudioTrackRepository extends Repository<ComfortAudioTrack> {
  constructor(private readonly dataSource: DataSource) {
    super(ComfortAudioTrack, dataSource.createEntityManager());
  }

  async getTracks(
    options: GetComfortAudioTracksOptions = {},
  ): Promise<{ tracks: ComfortAudioTrack[]; count: number }> {
    const {
      limit = 50,
      offset = 0,
      sortBy = ComfortAudioTrackSortBy.CREATED_AT,
      sortOrder = ComfortAudioTrackSortOrder.DESC,
      includeArchived = false,
    } = options;

    const query = this.createQueryBuilder('comfortAudioTrack')
      .orderBy(
        `comfortAudioTrack.${sortBy}`,
        sortOrder.toUpperCase() as 'ASC' | 'DESC',
      )
      .limit(limit)
      .offset(offset);

    if (!includeArchived) {
      query.andWhere('comfortAudioTrack.archivedAt IS NULL');
    }

    const [tracks, count] = await query.getManyAndCount();
    return { tracks, count };
  }
}
