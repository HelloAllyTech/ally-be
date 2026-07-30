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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  CreateOpportunityDto,
  ListOpportunitiesQueryDto,
  MergeOpportunitiesDto,
  SetAllocationDto,
  SplitOpportunityDto,
  UpdateOpportunityDto,
} from '../dto/roadmap-opportunity.dto';
import {
  CoinBudgetDto,
  GetOpportunitiesResponseDto,
  OpportunityResponseDto,
  RoadmapFacetsDto,
  SetAllocationResponseDto,
} from '../dto/roadmap-response.dto';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapAllocationService } from '../service/roadmap-allocation.service';
import { RoadmapSplitMergeService } from '../service/roadmap-split-merge.service';

/**
 * The board itself.
 *
 * Permission tiers, applied per handler:
 *   VIEW_PRODUCT_ROADMAP — read the board
 *   VOTE_PRODUCT_ROADMAP — file an opportunity, allocate coins
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
  @Get('me/coin-budget')
  @ApiOperation({
    summary: "The caller's remaining coins for the current period",
  })
  @ApiResponse({ status: 200, type: CoinBudgetDto })
  budget(@CurrentUser() user: TokenUser): Promise<CoinBudgetDto> {
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

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
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

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Delete('opportunities/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft-delete an opportunity',
    description:
      'Also returns its coins to their owners, soft-deletes its comments, and removes it from ' +
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
    summary: 'Set the caller’s coins on one opportunity',
    description:
      'Idempotent; coins:0 deletes the allocation. periodKey is NOT accepted — the server ' +
      'computes it in UTC, which closes the source hole where any period could be written. ' +
      'Returns both the opportunity aggregate and the budget so an optimistic client can ' +
      'reconcile without refetching the list.',
  })
  @ApiResponse({ status: 200, type: SetAllocationResponseDto })
  setAllocation(
    @CurrentUser() user: TokenUser,
    @Body() dto: SetAllocationDto,
  ): Promise<SetAllocationResponseDto> {
    return this.allocationService.setCoins(
      user.id,
      dto.opportunityId,
      dto.coins,
    );
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('opportunities/:id/split')
  @ApiOperation({
    summary: 'Split an opportunity, redistributing coins by weight',
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

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('opportunities/merge')
  @ApiOperation({
    summary: 'Merge opportunities, rolling coins up per (user, period)',
  })
  merge(
    @CurrentUser() user: TokenUser,
    @Body() dto: MergeOpportunitiesDto,
  ): Promise<{ primaryId: string }> {
    return this.splitMergeService.merge(user.id, dto);
  }
}
