import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { RateLimit } from 'src/rate-limit/decorator/rate-limit.decorator';

import { BUG_REPORT_RATE_LIMIT } from '../constants/product-roadmap.constants';
import {
  CreateBugReportDto,
  CreateOpportunityDto,
  ListOpportunitiesQueryDto,
  MergeOpportunitiesDto,
  MonthBoardQueryDto,
  MoveOpportunityDto,
  SetAllocationDto,
  SplitOpportunityDto,
  UpdateOpportunityDto,
} from '../dto/roadmap-opportunity.dto';
import {
  VoteBudgetDto,
  BugReportResponseDto,
  GetOpportunitiesResponseDto,
  MonthBoardMoveResponseDto,
  MonthBoardResponseDto,
  OpportunityResponseDto,
  RoadmapFacetsDto,
  SetAllocationResponseDto,
  OpenBuilderSessionResponseDto,
} from '../dto/roadmap-response.dto';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapAllocationService } from '../service/roadmap-allocation.service';
import { RoadmapSplitMergeService } from '../service/roadmap-split-merge.service';
import { RoadmapBuilderService } from '../service/roadmap-builder.service';
import { RoadmapBoardService } from '../service/roadmap-board.service';

/**
 * The board itself.
 *
 * Permission tiers, applied per handler:
 *   VIEW_PRODUCT_ROADMAP — read the board
 *   VOTE_PRODUCT_ROADMAP — file an opportunity, cast votes
 *   EDIT_PRODUCT_ROADMAP — change stages, edit or delete anyone's opportunity, split, merge
 */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapOpportunityController {
  constructor(
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly allocationService: RoadmapAllocationService,
    private readonly splitMergeService: RoadmapSplitMergeService,
    private readonly builderService: RoadmapBuilderService,
    private readonly boardService: RoadmapBoardService,
  ) {}

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('opportunities')
  @ApiOperation({
    summary: 'List opportunities',
    description:
      'Filtering, sorting and pagination all happen in SQL, and priorityScore is a SQL ' +
      'aggregate. maxScore is deliberately unfiltered so the priority bars keep a stable ' +
      'scale. periodKey is server-computed — clients must never derive it.',
  })
  @ApiResponse({ status: 200, type: GetOpportunitiesResponseDto })
  list(
    @CurrentUser() user: TokenUser,
    @Query() query: ListOpportunitiesQueryDto,
  ): Promise<GetOpportunitiesResponseDto> {
    return this.opportunityService.list(user.id, query);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('board')
  @ApiOperation({
    summary:
      'The month board: the same opportunities, grouped into month lanes',
    description:
      'A card sits in the month it was PLANNED into, except once it has shipped, when it sits in ' +
      'the month it actually shipped — so a slipped plan stays visible instead of being ' +
      'rewritten. Windowed by month rather than paginated by offset, because a lane has to be ' +
      'complete to be honest. Every month in the window is returned including empty ones, each ' +
      'lane reports its true total even when laneLimit truncates it, and unscheduled cards are ' +
      'always in scope. Accepts every filter the table accepts.',
  })
  @ApiResponse({ status: 200, type: MonthBoardResponseDto })
  board(
    @CurrentUser() user: TokenUser,
    @Query() query: MonthBoardQueryDto,
  ): Promise<MonthBoardResponseDto> {
    return this.boardService.getBoard(user.id, query);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('board/lane')
  @ApiOperation({
    summary: 'Move a card into a month lane and set that lane’s order',
    description:
      'Idempotent: orderedIds is the full resulting order of the destination lane, not a delta, ' +
      'so two people dragging in one lane cannot interleave into an order neither of them saw. ' +
      'Ids that no longer belong to the lane are skipped rather than rejected, and the response ' +
      'lists what was actually reordered. Moving a RELEASED card out of its release month is a ' +
      '422 — reordering it within that month is allowed. Manage-gated, matching PATCH.',
  })
  @ApiResponse({ status: 200, type: MonthBoardMoveResponseDto })
  moveOnBoard(
    @CurrentUser() user: TokenUser,
    @Body() dto: MoveOpportunityDto,
  ): Promise<MonthBoardMoveResponseDto> {
    return this.boardService.move(user.id, dto);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('facets')
  @ApiOperation({
    summary: 'Distinct filter options',
    description:
      'Exists because deriving filter options from the loaded rows breaks as soon as the list ' +
      'is paginated.',
  })
  @ApiResponse({ status: 200, type: RoadmapFacetsDto })
  facets(): Promise<RoadmapFacetsDto> {
    return this.opportunityService.getFacets();
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('me/vote-budget')
  @ApiOperation({
    summary: "The caller's remaining votes for the current period",
  })
  @ApiResponse({ status: 200, type: VoteBudgetDto })
  budget(@CurrentUser() user: TokenUser): Promise<VoteBudgetDto> {
    return this.allocationService.getBudget(user.id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('opportunities/:id')
  @ApiOperation({
    summary: 'One opportunity',
    description:
      'Used for the ?opportunity=<id> deep link, where the row may not be on the current page.',
  })
  @ApiResponse({ status: 200, type: OpportunityResponseDto })
  findOne(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OpportunityResponseDto> {
    return this.opportunityService.findOne(user.id, id);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('opportunities')
  @ApiOperation({ summary: 'File a new opportunity' })
  @ApiResponse({ status: 201, type: OpportunityResponseDto })
  create(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateOpportunityDto,
  ): Promise<OpportunityResponseDto> {
    return this.opportunityService.create(user.id, dto);
  }

  /**
   * The bug counterpart of `create` above, and the ONE route every bug report takes: a
   * consumer in web/mobile/helpline, and a staff member using the admin roadmap's "Report a
   * bug" button, both land here. Deliberately a separate route on a plain JwtAuthGuard
   * rather than widening vote:admin:product-roadmap to consumer accounts — and the staff
   * button reuses it rather than posting a `bug`-type opportunity to /opportunities, so
   * every report carries the same silently-captured triage context regardless of who filed
   * it. `source` is derived from the reporter's own roles; see isInternalReporter.
   *
   * Goes through the exact same RoadmapOpportunityService.create() pipeline as the staff
   * path (Bug Hunter inbox row, vector indexing), so it needs no bespoke follow-up work to
   * show up where bugs are triaged.
   */
  @UseGuards(JwtAuthGuard)
  @RateLimit({
    key: 'userId',
    name: 'bugReport',
    limit: BUG_REPORT_RATE_LIMIT.LIMIT,
    ttl: BUG_REPORT_RATE_LIMIT.TTL_MS,
    errorMessage: 'Too many bug reports. Please try again later.',
  })
  @Post('bug-reports')
  @ApiOperation({
    summary: 'File a bug report as any logged-in user',
    description:
      'Lands as a `bug`-type opportunity and, through the same pipeline, as a row in Bug ' +
      "Hunter's findings table — where bugs are triaged, since they no longer render on " +
      "the roadmap board. `source` is stamped 'staff' or 'consumer' from the reporter's " +
      'own roles. No severity or category picker — the description is the answer to a ' +
      'single guided prompt. Not run through any crisis-content safety pipeline: this is ' +
      'a plain admin-visible field.',
  })
  @ApiResponse({ status: 201, type: BugReportResponseDto })
  createBugReport(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateBugReportDto,
  ): Promise<BugReportResponseDto> {
    return this.opportunityService.createBugReport(
      user.id,
      user.tenantId ?? null,
      dto,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('opportunities/:id')
  @ApiOperation({
    summary: 'Update an opportunity',
    description:
      'Manage-gated, which means the AUTHOR cannot edit their own opportunity unless they also ' +
      'hold edit:. That is a faithful port of the source (UPDATE was admin-only under RLS) and ' +
      'is flagged for review rather than silently changed.',
  })
  @ApiResponse({ status: 200, type: OpportunityResponseDto })
  update(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOpportunityDto,
  ): Promise<OpportunityResponseDto> {
    return this.opportunityService.update(user.id, id, dto);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Delete('opportunities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete an opportunity',
    description:
      'Also returns its votes to their owners, soft-deletes its comments, and removes it from ' +
      'the vector index so duplicate detection stops proposing it.',
  })
  remove(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.opportunityService.remove(user.id, id);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Put('allocations')
  @ApiOperation({
    summary: 'Set the caller’s votes on one opportunity',
    description:
      'Idempotent; votes:0 deletes the allocation. periodKey is NOT accepted — the server ' +
      'computes it in UTC, which closes the source hole where any period could be written. ' +
      'Returns both the opportunity aggregate and the budget so an optimistic client can ' +
      'reconcile without refetching the list.',
  })
  @ApiResponse({ status: 200, type: SetAllocationResponseDto })
  setAllocation(
    @CurrentUser() user: TokenUser,
    @Body() dto: SetAllocationDto,
  ): Promise<SetAllocationResponseDto> {
    return this.allocationService.setVotes(
      user.id,
      dto.opportunityId,
      dto.votes,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('opportunities/:id/split')
  @ApiOperation({
    summary: 'Split an opportunity, redistributing votes by weight',
    description:
      'Exactly one part must carry the original id; that part is kept and reworded so its ' +
      'comments and share links survive.',
  })
  split(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SplitOpportunityDto,
  ): Promise<{ partIds: string[] }> {
    return this.splitMergeService.split(user.id, id, dto.parts);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('opportunities/:id/builder-session')
  @ApiOperation({
    summary: 'Open (or resume) the Builder session for this opportunity',
    description:
      'Idempotent: returns the existing session when one is already linked, so pressing the ' +
      'button twice resumes rather than starting a second interview. `created: true` means the ' +
      'client must send the returned `seedMessage` as the first interview turn. Gated on the ' +
      "ROADMAP's manage rule; Builder's own toggle and edit permission are checked in the " +
      'service, because a roadmap manager is not automatically a Builder user.',
  })
  @ApiResponse({ status: 201, type: OpenBuilderSessionResponseDto })
  openBuilderSession(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OpenBuilderSessionResponseDto> {
    return this.builderService.openSession(user.id, id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('opportunities/merge')
  @ApiOperation({
    summary: 'Merge opportunities, rolling votes up per (user, period)',
  })
  merge(
    @CurrentUser() user: TokenUser,
    @Body() dto: MergeOpportunitiesDto,
  ): Promise<{ primaryId: string }> {
    return this.splitMergeService.merge(user.id, dto);
  }
}
