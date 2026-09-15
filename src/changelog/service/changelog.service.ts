import { Injectable } from '@nestjs/common';

import { GetPublicChangelogEntriesResponseDto } from '../dto/changelog-entry-response.dto';
import { ChangelogSourceService } from './changelog-source.service';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;

@Injectable()
export class ChangelogService {
  constructor(private readonly sourceService: ChangelogSourceService) {}

  /**
   * One page of the feed, newest first.
   *
   * Paging in memory rather than in SQL: the whole file is a few hundred
   * kilobytes and is already parsed and held by ChangelogSourceService, so a
   * slice costs nothing a query would have saved. `count` is the total, which
   * the page uses to know whether a "Load more" button has anything behind it.
   */
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

    const all = await this.sourceService.getEntries();

    return {
      entries: all
        .slice(resolvedOffset, resolvedOffset + resolvedLimit)
        .map((entry) => ({
          id: entry.id,
          releaseNoteText: entry.releaseNoteText,
          mergedAt: entry.mergedAt,
        })),
      count: all.length,
    };
  }
}
