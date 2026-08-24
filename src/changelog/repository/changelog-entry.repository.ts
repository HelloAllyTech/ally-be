import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { ChangelogEntry } from '../entity/changelog-entry.entity';

@Injectable()
export class ChangelogEntryRepository extends Repository<ChangelogEntry> {
  constructor(private readonly dataSource: DataSource) {
    super(ChangelogEntry, dataSource.createEntityManager());
  }

  async findPublic(
    limit: number,
    offset: number,
  ): Promise<[ChangelogEntry[], number]> {
    return this.findAndCount({
      order: { mergedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
