import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from 'src/auth/decorators/auth.metadata';

import { GetPublicChangelogEntriesResponseDto } from '../dto/changelog-entry-response.dto';
import { GetPublicChangelogEntriesDto } from '../dto/get-public-changelog-entries.dto';
import { ChangelogService } from '../service/changelog.service';

/**
 * The public changelog feed, served to the helpline dashboard's
 * `/blog/changelog` page with no auth at all.
 *
 * Read-only, and there is nothing to write to: the feed is
 * `ally-changelog`'s CHANGELOG.md, read through ChangelogSourceService. The
 * `POST` that used to ingest one entry per merge (and the table behind it) is
 * gone — it made the published feed uncorrectable, since the only way to
 * change a line was to append a new one.
 */
@ApiTags('Changelog')
@Controller('v1/changelog')
export class ChangelogController {
  constructor(private readonly changelogService: ChangelogService) {}

  @Get('public')
  @Public()
  @ApiOperation({
    summary: 'List changelog entries, newest first (public, no auth required)',
  })
  @ApiResponse({ status: 200, type: GetPublicChangelogEntriesResponseDto })
  async getPublicEntries(
    @Query() query: GetPublicChangelogEntriesDto,
  ): Promise<GetPublicChangelogEntriesResponseDto> {
    return this.changelogService.findPublic(query);
  }
}
