import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { TrackTranslation } from '../entity/track-translation.entity';
import { TrackTranslationStatus } from '../type/track-translation.type';

@Injectable()
export class TrackTranslationRepository extends Repository<TrackTranslation> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackTranslation, dataSource.createEntityManager());
  }

  findByTrackId(trackId: string): Promise<TrackTranslation[]> {
    return this.find({ where: { trackId }, order: { languageId: 'ASC' } });
  }

  findOneByTrackAndLanguage(
    trackId: string,
    languageId: number,
  ): Promise<TrackTranslation | null> {
    return this.findOne({ where: { trackId, languageId } });
  }

  /** Only the languages a learner may actually be served. */
  findPublishedByTrackId(trackId: string): Promise<TrackTranslation[]> {
    return this.find({
      where: { trackId, status: TrackTranslationStatus.PUBLISHED },
      order: { languageId: 'ASC' },
    });
  }

  findPublishedByTrackIds(trackIds: string[]): Promise<TrackTranslation[]> {
    if (!trackIds.length) return Promise.resolve([]);
    return this.find({
      where: {
        trackId: In(trackIds),
        status: TrackTranslationStatus.PUBLISHED,
      },
    });
  }
}
