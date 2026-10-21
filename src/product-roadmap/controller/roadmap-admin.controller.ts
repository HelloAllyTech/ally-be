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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
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
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

import {
  AiDraftDto,
  AiGenerateClaudePromptDto,
  AiSummariseDto,
  OpportunityInterviewTurnDto,
  RoadmapImportRequestDto,
  CreateInterviewNoteDto,
  CreateTaxonomyItemDto,
  RenameTaxonomyItemDto,
  ReorderTaxonomyDto,
  RoadmapListQueryDto,
  UpdateInterviewNoteDto,
} from '../dto/roadmap-content.dto';
import {
  AiReadinessCriteriaResponseDto,
  AiTextResponseDto,
  DuplicatesResponseDto,
  OpportunityInterviewTurnResponseDto,
  PruneVectorsResponseDto,
  RoadmapImportResultDto,
  ReindexResponseDto,
  RoadmapEligibleOwnerDto,
} from '../dto/roadmap-response.dto';
import {
  BulkAssessResponseDto,
  CreateStrategyGoalDto,
  GoalImpactVerdictDto,
  RankWeightsResponseDto,
  RenameStrategyGoalDto,
  ReorderStrategyGoalsDto,
  RoadmapStrategyContextDto,
  StrategyGoalsResponseDto,
  UpdateRankWeightsDto,
  UpdateRoadmapStrategyContextDto,
} from '../dto/roadmap-strategy.dto';
import { RoadmapImportService } from '../service/roadmap-import.service';
import { RoadmapStrategyContextService } from '../service/roadmap-strategy-context.service';
import { RoadmapOpportunityService } from '../service/roadmap-opportunity.service';
import { RoadmapTaxonomyService } from '../service/roadmap-taxonomy.service';
import { RoadmapStrategyGoalService } from '../service/roadmap-strategy-goal.service';
import { RoadmapGoalImpactService } from '../service/roadmap-goal-impact.service';
import { RoadmapInterviewNoteService } from '../service/roadmap-content.service';
import { RoadmapAiService } from '../service/roadmap-ai.service';
import { RoadmapVectorService } from '../service/roadmap-vector.service';
import { RoadmapAccessService } from '../service/roadmap-access.service';
import { RoadmapCopilotService } from '../service/roadmap-copilot.service';
import {
  ROADMAP_COPILOT,
  ROADMAP_FILEABLE_EFFORTS,
  ROADMAP_READINESS_CRITERIA,
} from '../constants/product-roadmap.constants';
import { RoadmapOpportunityEffort } from '../enum/roadmap-opportunity.enum';

/** Taxonomy, research notes, release notes, AI helpers, and the vector-index repair tools. */
@ApiTags('Product Roadmap')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'product-roadmap', version: '1' })
export class RoadmapAdminController {
  constructor(
    private readonly taxonomyService: RoadmapTaxonomyService,
    private readonly interviewService: RoadmapInterviewNoteService,
    private readonly aiService: RoadmapAiService,
    private readonly vectorService: RoadmapVectorService,
    private readonly opportunityService: RoadmapOpportunityService,
    private readonly importService: RoadmapImportService,
    private readonly access: RoadmapAccessService,
    private readonly strategyGoalService: RoadmapStrategyGoalService,
    private readonly goalImpactService: RoadmapGoalImpactService,
    private readonly strategyContextService: RoadmapStrategyContextService,
    private readonly copilotService: RoadmapCopilotService,
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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Get('product-goals/usage')
  @ApiOperation({
    summary: 'Opportunity count per goal, so a delete shows its cost first',
  })
  goalUsage() {
    return this.taxonomyService.getGoalUsage();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('product-goals')
  createGoal(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateTaxonomyItemDto,
  ) {
    return this.taxonomyService.createGoal(user.id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('product-goals/order')
  reorderGoals(
    @CurrentUser() user: TokenUser,
    @Body() dto: ReorderTaxonomyDto,
  ) {
    return this.taxonomyService.reorderGoals(user.id, dto.ids);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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
    summary: 'The users who may own an opportunity',
    description:
      "The owner picker's options: the named product leads in ROADMAP_OWNER_EMAILS, matched " +
      'by email. Deliberately a short, explicit list rather than every platform admin — see ' +
      'the constant. Changing it is a code change; existing assignments are left untouched.',
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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Get('opportunity-owners/usage')
  ownerUsage() {
    return this.taxonomyService.getOwnerUsage();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('opportunity-owners')
  createOwner(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateTaxonomyItemDto,
  ) {
    return this.taxonomyService.createOwner(user.id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('opportunity-owners/:id')
  renameOwner(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameTaxonomyItemDto,
  ) {
    return this.taxonomyService.renameOwner(user.id, id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('opportunity-owners/order')
  reorderOwners(
    @CurrentUser() user: TokenUser,
    @Body() dto: ReorderTaxonomyDto,
  ) {
    return this.taxonomyService.reorderOwners(user.id, dto.ids);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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

  // ── Vision & strategy page ────────────────────────────────────────────────
  // The prose the opportunity copilot reads on every turn: vision, audience, bets, non-goals,
  // measures. Read on the VIEW tier like the strategy goals below — the copilot's pushback
  // cites it, and a filer told "this conflicts with a non-goal" must be able to read the
  // non-goal. Written on the same manage gate as every other strategy setting.

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('strategy-context')
  @ApiOperation({
    summary: 'The Vision & strategy page',
    description:
      'Every field is a string, empty when unwritten. `updatedAt` is null until first saved.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RoadmapStrategyContextDto })
  getStrategyContext(): Promise<RoadmapStrategyContextDto> {
    return this.strategyContextService.get();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('strategy-context')
  @ApiOperation({
    summary: 'Update the Vision & strategy page',
    description:
      'A field left out keeps its current text. The opportunity copilot reads the saved page ' +
      'from its next turn on.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: RoadmapStrategyContextDto })
  updateStrategyContext(
    @CurrentUser() user: TokenUser,
    @Body() dto: UpdateRoadmapStrategyContextDto,
  ): Promise<RoadmapStrategyContextDto> {
    return this.strategyContextService.update(user.id, dto);
  }

  // ── product strategy goals & composite rank ───────────────────────────────
  // A DIFFERENT CONCEPT from the product goals above, and worth not conflating: those are
  // CATEGORIES (exactly one per opportunity, used to file and filter). These are OUTCOMES the
  // board is ranked against, and one opportunity may advance several or none. Same id-not-name
  // path-parameter rule, for the same reason.

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('strategy-goals')
  @ApiOperation({
    summary: 'Strategy goals, each with its unassessed count',
    description:
      'VIEW-gated rather than EDIT-gated because every card shows a coverage figure these ' +
      'goals define — a reader who cannot name them cannot read the rank.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: StrategyGoalsResponseDto })
  async listStrategyGoals(): Promise<StrategyGoalsResponseDto> {
    const [goals, unassessed, needingAssessment] = await Promise.all([
      this.strategyGoalService.listGoals(),
      this.strategyGoalService.getUnassessedCounts(),
      this.goalImpactService.countNeedingAssessment(),
    ]);
    return {
      goals: goals.map((g) => ({
        id: g.id,
        name: g.name,
        position: g.position,
        unassessed: unassessed[g.name] ?? 0,
      })),
      needingAssessment,
    };
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('strategy-goals')
  @ApiOperation({
    summary: 'Add a strategy goal',
    description:
      'Returns how many opportunities are now unassessed against it. Adding a goal grows the ' +
      'coverage denominator, so every score drops until a bulk assessment catches up — the ' +
      'count is returned so the UI can say so instead of letting the board look re-ranked.',
  })
  createStrategyGoal(
    @CurrentUser() user: TokenUser,
    @Body() dto: CreateStrategyGoalDto,
  ) {
    return this.strategyGoalService.createGoal(user.id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('strategy-goals/:id')
  @ApiOperation({
    summary: 'Rename a strategy goal',
    description:
      'Free: ON UPDATE CASCADE carries every stored verdict across, so nothing needs ' +
      'reassessing. A rename that changes the goal MEANING does leave verdicts judged against ' +
      'the old intent — reassess explicitly if so.',
  })
  renameStrategyGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameStrategyGoalDto,
  ) {
    return this.strategyGoalService.renameGoal(user.id, id, dto.name);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Put('strategy-goals/order')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorderStrategyGoals(
    @CurrentUser() user: TokenUser,
    @Body() dto: ReorderStrategyGoalsDto,
  ): Promise<void> {
    return this.strategyGoalService.reorderGoals(user.id, dto.ids);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Delete('strategy-goals/:id')
  @ApiOperation({
    summary: 'Delete a strategy goal',
    description:
      'Never blocks: the verdicts cascade away and coverage recomputes against the smaller ' +
      'denominator with no LLM calls. Returns how many assessments were discarded, because ' +
      'they cost money to produce and this is not reversible.',
  })
  deleteStrategyGoal(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.strategyGoalService.deleteGoal(user.id, id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('rank-weights')
  @ApiOperation({ summary: 'The four composite-rank factor weights' })
  @ApiResponse({ status: HttpStatus.OK, type: RankWeightsResponseDto })
  getRankWeights() {
    return this.strategyGoalService.getWeights();
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Patch('rank-weights')
  @ApiOperation({
    summary: 'Retune the composite rank',
    description:
      'PATCH semantics on purpose — one slider at a time, so two admins tuning different ' +
      'factors do not overwrite each other. Costs nothing but a re-sort: weights apply in SQL ' +
      'over factors that already exist, so this never re-runs the model.',
  })
  updateRankWeights(
    @CurrentUser() user: TokenUser,
    @Body() dto: UpdateRankWeightsDto,
  ) {
    return this.strategyGoalService.updateWeights(user.id, dto);
  }

  @AuthPermissions([PERMISSIONS.VIEW_PRODUCT_ROADMAP])
  @Get('opportunities/:id/goal-impact')
  @ApiOperation({ summary: "One opportunity's strategy-goal verdicts" })
  @ApiResponse({ status: HttpStatus.OK, type: [GoalImpactVerdictDto] })
  listGoalImpact(@Param('id', ParseUUIDPipe) id: string) {
    return this.goalImpactService.listForOpportunity(id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('opportunities/:id/goal-impact')
  @ApiOperation({
    summary: 'Reassess one opportunity against the current strategy',
    description:
      'The correction path for a verdict you disagree with. Verdicts are machine-derived and ' +
      'deliberately not hand-editable — a ranking input anyone could edit is one people would ' +
      'edit to move their own idea up.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: [GoalImpactVerdictDto] })
  reassessGoalImpact(
    @CurrentUser() user: TokenUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.goalImpactService.assess(id, user.id);
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
  @Post('strategy-goals/assess-missing')
  @ApiOperation({
    summary: 'Assess opportunities missing a verdict for at least one goal',
    description:
      'BOUNDED, and reports what remains. Adding a goal makes the whole board stale at once, ' +
      'and one request that billed all of it would time out — so a big backlog is several ' +
      'clicks rather than one call that silently truncates.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: BulkAssessResponseDto })
  assessMissing(@CurrentUser() user: TokenUser) {
    return this.goalImpactService.assessMissing(user.id);
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

  // ── AI helpers ────────────────────────────────────────────────────────────

  /**
   * The checklist itself — what the guided interview grades and shows as it goes. Served rather
   * than duplicated in the client so that editing ROADMAP_READINESS_CRITERIA is the entire
   * change — a second copy in the admin bundle would drift, and the drift would show up as a
   * checklist item the grader never grades.
   */
  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Get('ai/readiness/criteria')
  @ApiOperation({
    summary: 'The readiness checklist a draft is graded against',
  })
  @ApiResponse({ status: 200, type: AiReadinessCriteriaResponseDto })
  readinessCriteria(): AiReadinessCriteriaResponseDto {
    return {
      criteria: ROADMAP_READINESS_CRITERIA.map((c) => ({
        id: c.id,
        label: c.label,
        hint: c.hint,
      })),
      // Same reason as the criteria: the size threshold gates filing, so the client must not
      // hold its own copy of it.
      fileableEfforts: [
        ...ROADMAP_FILEABLE_EFFORTS,
      ] as RoadmapOpportunityEffort[],
    };
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

  /**
   * The only way to file an opportunity from the admin board, so it sits on the VOTE tier —
   * exactly who may file (`POST /opportunities`). It was manage-gated while it was an
   * experimental second door beside a blank form; with the form retired, leaving it there would
   * have taken filing away from everyone who can vote but not manage.
   *
   * Every tool the copilot can call is read-only and reads what a voter can already read in the
   * admin console, so giving it research does not widen the tier. It writes nothing until its
   * draft is filed, which has its own VOTE gate and verifies the token minted here.
   *
   * The JSON form of a turn, kept for the admin bundle already in production, which predates
   * the stream below — ally-be deploys ahead of ally-web. Same copilot, same turn, no progress.
   */
  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/opportunity-interview')
  @ApiOperation({
    summary: 'One turn of the opportunity copilot (JSON)',
    description:
      "Stateless: the client sends the whole conversation, plus the previous turn's `brief`, " +
      'and gets back the next message, a verdict on each readiness criterion and the working ' +
      'brief. Send an empty `messages` array for the opening turn. Once every criterion is met ' +
      'the response also carries a draft and a readiness token, minted over the draft and the ' +
      'brief. Prefer `ai/opportunity-interview/stream`, which reports research as it happens.',
  })
  @ApiResponse({ status: 201, type: OpportunityInterviewTurnResponseDto })
  async opportunityInterview(
    @CurrentUser() user: TokenUser,
    @Body() dto: OpportunityInterviewTurnDto,
  ): Promise<OpportunityInterviewTurnResponseDto> {
    return this.copilotService.takeTurn(
      { messages: dto.messages, brief: dto.brief },
      user.id,
    );
  }

  /**
   * The same turn as Server-Sent Events: `activity` and `activity_done` per lookup while the
   * copilot researches, then exactly one `turn` (the JSON route's body) or `error`. A turn that
   * reads analytics and the codebase can take a minute; a minute of "Thinking…" with no sign of
   * what it is doing is how people give up on a surface.
   *
   * No per-session lock, unlike Builder's stream: there is no session. Two tabs running turns
   * at once each get their own answer and neither writes anything.
   */
  @AuthPermissions([PERMISSIONS.VOTE_PRODUCT_ROADMAP])
  @Post('ai/opportunity-interview/stream')
  @ApiOperation({
    summary: 'One turn of the opportunity copilot (SSE)',
    description:
      'Events: `activity` {id,label} and `activity_done` {id,summary,ok} per research lookup, ' +
      '`ping` every 15s, then exactly one `turn` (an OpportunityInterviewTurnResponseDto) or ' +
      '`error` {message}. Request body as for `ai/opportunity-interview`.',
  })
  async opportunityInterviewStream(
    @CurrentUser() user: TokenUser,
    @Body() dto: OpportunityInterviewTurnDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Proxies that buffer (nginx) would otherwise hold every frame until the turn ends.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // `res` 'close' with !writableEnded is the real disconnect — see Builder's stream for why
    // `req` 'close' is not.
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) clientGone = true;
    });
    const write = (event: string, data: unknown): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    const heartbeat = setInterval(
      () => write('ping', { at: Date.now() }),
      ROADMAP_COPILOT.SSE_PING_MS,
    );
    try {
      for await (const frame of this.copilotService.streamTurn(
        { messages: dto.messages, brief: dto.brief },
        user.id,
      )) {
        write(frame.event, frame.data);
        // Nobody is listening; stop spending tokens on a turn no one will read.
        if (clientGone) break;
      }
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  }

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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

  @RequireFeatureToggle(FeatureToggleKey.PRODUCT_ROADMAP_MANAGE, {
    permissions: [PERMISSIONS.EDIT_PRODUCT_ROADMAP],
  })
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
