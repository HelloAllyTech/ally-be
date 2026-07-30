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
  AiDraftDto,
  AiReleaseNotesDto,
  AiSummariseDto,
  CreateInterviewNoteDto,
  CreateReleaseNoteDto,
  CreateTaxonomyItemDto,
  RenameTaxonomyItemDto,
  ReorderTaxonomyDto,
  RoadmapListQueryDto,
  UpdateInterviewNoteDto,
  UpdateReleaseNoteDto,
} from '../dto/roadmap-content.dto';
import {
  AiEnhanceResponseDto,
  AiReviewResponseDto,
  AiTextResponseDto,
  DuplicatesResponseDto,
  ReindexResponseDto,
} from '../dto/roadmap-response.dto';
import { RoadmapTaxonomyService } from '../service/roadmap-taxonomy.service';
import {
  RoadmapInterviewNoteService,
  RoadmapReleaseNoteService,
} from '../service/roadmap-content.service';
import { RoadmapAiService } from '../service/roadmap-ai.service';
import { RoadmapVectorService } from '../service/roadmap-vector.service';
import { RoadmapAccessService } from '../service/roadmap-access.service';

/** Taxonomy, research notes, release notes, AI helpers, and the vector-index repair tools. */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapAdminController {
  constructor(
    private readonly taxonomyService: RoadmapTaxonomyService,
    private readonly interviewService: RoadmapInterviewNoteService,
    private readonly releaseNoteService: RoadmapReleaseNoteService,
    private readonly aiService: RoadmapAiService,
    private readonly vectorService: RoadmapVectorService,
    private readonly access: RoadmapAccessService,
  ) {}

  // ── taxonomy ──────────────────────────────────────────────────────────────
  // Mutations key on the uuid id rather than the name: goal names contain spaces and
  // ampersands ("Engagement & Usability"), which makes them fragile path parameters.

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('product-goals')
  @ApiOperation({ summary: 'Product goals, in display order' })
  listGoals() {
    return this.taxonomyService.listGoals();
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Get('product-goals/usage')
  @ApiOperation({
    summary: 'Opportunity count per goal, so a delete shows its cost first',
  })
  goalUsage() {
    return this.taxonomyService.getGoalUsage();
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('product-goals')
  createGoal(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateTaxonomyItemDto,
  ) {
    return this.taxonomyService.createGoal(user.id, dto.name);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Patch('product-goals/:id')
  @ApiOperation({
    summary: 'Rename a goal',
    description:
      'Cascades to every opportunity via ON UPDATE CASCADE, which also keeps the goal names ' +
      'stored inside saved-view state valid.',
  })
  renameGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTaxonomyItemDto,
  ) {
    return this.taxonomyService.renameGoal(user.id, id, dto.name);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Put('product-goals/order')
  reorderGoals(
    @CurrentUser() user: TokenUser,
    @Body() dto: ReorderTaxonomyDto,
  ) {
    return this.taxonomyService.reorderGoals(user.id, dto.ids);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Delete('product-goals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a goal',
    description:
      'Answers 409 with the usage count while opportunities still reference it.',
  })
  deleteGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.taxonomyService.deleteGoal(user.id, id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('opportunity-owners')
  listOwners() {
    return this.taxonomyService.listOwners();
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Get('opportunity-owners/usage')
  ownerUsage() {
    return this.taxonomyService.getOwnerUsage();
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('opportunity-owners')
  createOwner(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateTaxonomyItemDto,
  ) {
    return this.taxonomyService.createOwner(user.id, dto.name);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Patch('opportunity-owners/:id')
  renameOwner(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTaxonomyItemDto,
  ) {
    return this.taxonomyService.renameOwner(user.id, id, dto.name);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Put('opportunity-owners/order')
  reorderOwners(
    @CurrentUser() user: TokenUser,
    @Body() dto: ReorderTaxonomyDto,
  ) {
    return this.taxonomyService.reorderOwners(user.id, dto.ids);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Delete('opportunity-owners/:id')
  @ApiOperation({
    summary: 'Delete an owner',
    description:
      'Does NOT block: the FK is ON DELETE SET NULL, so affected opportunities are un-assigned. ' +
      'Returns how many.',
  })
  deleteOwner(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.taxonomyService.deleteOwner(user.id, id);
  }

  // ── interview notes ───────────────────────────────────────────────────────

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('interview-notes')
  listInterviews(@Query() query: RoadmapListQueryDto) {
    return this.interviewService.list(query);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('interview-notes')
  createInterview(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateInterviewNoteDto,
  ) {
    return this.interviewService.create(user.id, dto);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Patch('interview-notes/:id')
  @ApiOperation({ summary: 'Edit a note (author or manager)' })
  async updateInterview(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInterviewNoteDto,
  ) {
    return this.interviewService.update(
      user.id,
      id,
      dto,
      await this.access.canManage(user.id),
    );
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Delete('interview-notes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeInterview(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.interviewService.remove(
      user.id,
      id,
      await this.access.canManage(user.id),
    );
  }

  // ── release notes ─────────────────────────────────────────────────────────
  // READ is VIEW-gated, WRITE is EDIT-gated. Deliberate: the source used RLS, so a non-admin
  // SELECT returned 200 [] rather than 403, and its client relied on that.

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('release-notes')
  listReleaseNotes(@Query() query: RoadmapListQueryDto) {
    return this.releaseNoteService.list(query);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('release-notes')
  createReleaseNote(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateReleaseNoteDto,
  ) {
    return this.releaseNoteService.create(user.id, dto);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Patch('release-notes/:id')
  updateReleaseNote(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseNoteDto,
  ) {
    return this.releaseNoteService.update(user.id, id, dto);
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Delete('release-notes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeReleaseNote(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.releaseNoteService.remove(user.id, id);
  }

  // ── AI helpers ────────────────────────────────────────────────────────────

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/review')
  @ApiOperation({ summary: 'Critique a draft; at most 3 issue/tip pairs' })
  @ApiResponse({ status: 201, type: AiReviewResponseDto })
  review(@Body() dto: AiDraftDto): Promise<AiReviewResponseDto> {
    return this.aiService.reviewDraft(dto.description);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/enhance')
  @ApiOperation({ summary: 'Rewrite a draft' })
  @ApiResponse({ status: 201, type: AiEnhanceResponseDto })
  enhance(@Body() dto: AiDraftDto): Promise<AiEnhanceResponseDto> {
    return this.aiService.enhanceDraft(dto.description);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/duplicates')
  @ApiOperation({
    summary: 'Semantic duplicate check',
    description:
      'Weaviate candidates + same-goal safety net + an LLM confirmation pass. Degrades to an ' +
      'empty list when ally-ai is unavailable so it can never block filing an opportunity.',
  })
  @ApiResponse({ status: 201, type: DuplicatesResponseDto })
  duplicates(@Body() dto: AiDraftDto): Promise<DuplicatesResponseDto> {
    return this.aiService.findDuplicates(dto.description, dto.productGoal);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/classify')
  @ApiOperation({
    summary: 'Suggest a product goal for a draft',
    description:
      'Returns category:null when the model answers with something that is not a live goal — ' +
      'the guard the source lacked, which is how 241 opportunities acquired a fabricated goal.',
  })
  classify(@Body() dto: AiDraftDto) {
    return this.aiService.classifyGoal(dto.description);
  }

  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/summarise')
  @ApiOperation({ summary: 'Summarise an interview transcript' })
  @ApiResponse({ status: 201, type: AiTextResponseDto })
  async summarise(@Body() dto: AiSummariseDto): Promise<AiTextResponseDto> {
    return { text: await this.aiService.summariseTranscript(dto.transcript) };
  }

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('ai/release-notes')
  @ApiOperation({
    summary: 'Draft release notes from released opportunities',
    description:
      'Non-released selections are filtered out before the model sees them.',
  })
  @ApiResponse({ status: 201, type: AiTextResponseDto })
  async draftReleaseNotes(
    @Body() dto: AiReleaseNotesDto,
  ): Promise<AiTextResponseDto> {
    return { text: await this.aiService.draftReleaseNotes(dto.opportunityIds) };
  }

  // ── vector-index repair ───────────────────────────────────────────────────

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('admin/reindex')
  @ApiOperation({
    summary: 'Re-index opportunities into Weaviate',
    description:
      'The repair tool for index drift, and the one-time backfill after the Supabase import ' +
      '(505 rows ≈ 8 batches). Reports per-item failures rather than claiming success.',
  })
  @ApiResponse({ status: 201, type: ReindexResponseDto })
  reindex(@Query('force') force?: string): Promise<ReindexResponseDto> {
    return this.vectorService.reindexAll(force === 'true');
  }
}
