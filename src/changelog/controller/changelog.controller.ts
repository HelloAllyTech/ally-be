import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from 'src/auth/decorators/auth.metadata';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';

import {
  ChangelogEntryResponseDto,
  GetPublicChangelogEntriesResponseDto,
} from '../dto/changelog-entry-response.dto';
import { CreateChangelogEntryDto } from '../dto/create-changelog-entry.dto';
import { GetPublicChangelogEntriesDto } from '../dto/get-public-changelog-entries.dto';
import { ChangelogService } from '../service/changelog.service';

/**
 * Ingest surface for the platform-wide changelog feed, called by the
 * `ally-changelog` repo's `append-entry.yml` GitHub Action on every merge
 * across the platform's repos — not by a human. `x-api-key` guarded
 * (`ApiAuthGuard`, the same platform `API_KEY` already used for
 * ally-ai/ally-ai-learn inbound calls) rather than `@RequireFeatureToggle`,
 * whose `AuthGuard('jwt')` requires a logged-in human, which an automated CI
 * workflow is not. The public read side (`GET /public`) is `@Public()` and
 * served to the helpline dashboard's `/blog/changelog` page with no auth at
 * all.
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

  @Post()
  @UseGuards(ApiAuthGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: 'Ingest one changelog entry (pipeline only, x-api-key guarded)',
  })
  @ApiResponse({ status: 201, type: ChangelogEntryResponseDto })
  async create(
    @Body() body: CreateChangelogEntryDto,
  ): Promise<ChangelogEntryResponseDto> {
    return this.changelogService.create(body);
  }
}
