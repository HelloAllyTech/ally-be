import { Injectable } from '@nestjs/common';

import { CreateChangelogEntryDto } from '../dto/create-changelog-entry.dto';
import { GetPublicChangelogEntriesResponseDto } from '../dto/changelog-entry-response.dto';
import { ChangelogEntry } from '../entity/changelog-entry.entity';
import { ChangelogEntryRepository } from '../repository/changelog-entry.repository';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;

@Injectable()
export class ChangelogService {
  constructor(
    private readonly changelogEntryRepository: ChangelogEntryRepository,
  ) {}

  async create(dto: CreateChangelogEntryDto): Promise<ChangelogEntry> {
    const entry = this.changelogEntryRepository.create({
      repo: dto.repo,
      releaseNoteText: dto.releaseNoteText,
      mergedAt: new Date(dto.mergedAt),
    });
    return this.changelogEntryRepository.save(entry);
  }

  async findPublic({
    limit,
    offset,
  }: {
    limit?: number;
    offset?: number;
  }): Promise<GetPublicChangelogEntriesResponseDto> {
    const resolvedLimit = Math.min(
      Math.max(limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );
    const resolvedOffset = Math.max(offset ?? DEFAULT_OFFSET, 0);

    const [entries, count] = await this.changelogEntryRepository.findPublic(
      resolvedLimit,
      resolvedOffset,
    );

    return {
      entries: entries.map((entry) => ({
        id: entry.id,
        releaseNoteText: entry.releaseNoteText,
        mergedAt: entry.mergedAt,
      })),
      count,
    };
  }
}
