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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
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
  AiGenerateClaudePromptDto,
  AiReleaseNotesDto,
  AiSummariseDto,
  RoadmapImportRequestDto,
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
  PruneVectorsResponseDto,
  RoadmapImportResultDto,
  ReindexResponseDto,
  RoadmapEligibleOwnerDto,
} from '../dto/roadmap-response.dto';
import { RoadmapImportService } from '../service/roadmap-import.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
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
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly importService: RoadmapImportService,
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
  @Get('opportunity-owners/eligible')
  @ApiOperation({
    summary: 'Ally super-admin users who may own an opportunity',
    description:
      "The owner picker's options. Derived from SUPER_ADMIN / SUPER_DUPER_ADMIN group " +
      'membership rather than a hand-maintained list, so losing super-admin removes someone ' +
      'from the picker with no separate cleanup. Existing assignments are left untouched.',
  })
  @ApiResponse({ status: 200, type: [RoadmapEligibleOwnerDto] })
  listEligibleOwners(): Promise<RoadmapEligibleOwnerDto[]> {
    return this.opportunityService.listEligibleOwners();
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
  @Post('ai/generate-claude-prompt')
  @ApiOperation({
    summary: 'Generate a Claude Code implementation prompt from an opportunity',
    description:
      'Turns the opportunity description (and optional PRD) into a ready-to-paste brief for ' +
      'an AI coding agent. Manage-gated: this is a hand-off-to-engineering action, not a ' +
      'voting action.',
  })
  @ApiResponse({ status: 201, type: AiTextResponseDto })
  async generateClaudePrompt(
    @Body() dto: AiGenerateClaudePromptDto,
  ): Promise<AiTextResponseDto> {
    return {
      text: await this.aiService.generateClaudeCodePrompt(
        dto.description,
        dto.prd,
      ),
    };
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

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('admin/vectors/prune')
  @ApiOperation({
    summary: 'Delete vectors whose opportunity no longer exists',
    description:
      'The other half of repair: reindex only pushes Postgres into Weaviate, so it can never ' +
      'remove a vector left behind by a HARD-deleted row. Such an orphan is filtered out of ' +
      'results but still consumes one of the top-N similarity slots a real duplicate needed. ' +
      'Deletes on the basis of absence, so it refuses to act when the orphan ratio is high ' +
      'enough to suggest our own id set is incomplete — check `abortedReason` on the response.',
  })
  @ApiResponse({ status: 201, type: PruneVectorsResponseDto })
  pruneVectors(): Promise<PruneVectorsResponseDto> {
    return this.vectorService.pruneOrphanedVectors();
  }
  // ── one-off Supabase migration ────────────────────────────────────────────

  @AuthPermissions([PERMISSIONS.EDIT_PRODUCT_ROADMAP])
  @Post('admin/import')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: "Import the standalone roadmap app's Supabase snapshot",
    description:
      'Runs the SAME transaction and the same 16 verification checks as the CLI importer — the ' +
      'logic is shared, not duplicated. Exists so the migration does not require a host that can ' +
      'reach production Postgres, and so a snapshot containing user-interview transcripts never ' +
      'has to move between machines. ' +
      'DRY RUN BY DEFAULT: send dryRun="false" to commit. On any failed check the transaction is ' +
      'rolled back and the per-check detail is returned in the body rather than thrown, so the ' +
      'caller can see which check failed and by how much.',
  })
  @ApiResponse({ status: 201, type: RoadmapImportResultDto })
  importSnapshot(
    @CurrentUser() user: TokenUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: RoadmapImportRequestDto,
  ): Promise<RoadmapImportResultDto> {
    return this.importService.importFromBundle(user.id, file, {
      // Multipart values are strings. Only the exact string 'false' commits — a typo, a missing
      // field or a truthy-looking value all fall back to a dry run.
      dryRun: dto.dryRun !== 'false',
      createMissingUsers: dto.createMissingUsers === 'true',
      allowUserCreation: dto.allowUserCreation === 'true',
      tenantId: dto.tenantId,
    });
  }
}
