import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { TrackJournalEntry } from '../entity/track-journal-entry.entity';

@Injectable()
export class TrackJournalEntryRepository extends Repository<TrackJournalEntry> {
  constructor(private readonly dataSource: DataSource) {
    super(TrackJournalEntry, dataSource.createEntityManager());
  }

  async findByProgressId(
    trackItemProgressId: string,
  ): Promise<TrackJournalEntry[]> {
    return this.find({ where: { trackItemProgressId } });
  }
}
