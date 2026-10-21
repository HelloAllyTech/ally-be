import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { LoggerService } from 'src/logger/logger.service';
import { RedisService } from 'src/redis/service/redis.service';
import { BuilderSessionService } from '../service/builder-session.service';
import { BuilderPrdService } from '../service/builder-prd.service';
import { BuilderKnowledgeService } from '../service/builder-knowledge.service';
import { BuilderInterviewOrchestratorService } from '../service/builder-interview-orchestrator.service';
import { BuilderBuildService } from '../service/builder-build.service';
import { BuilderEventService } from '../service/builder-event.service';
import { BuilderPullRequestService } from '../service/builder-pull-request.service';
import {
  autonomyLevelOf,
  nextAutonomyLevel,
  switchesForAutonomyLevel,
} from '../util/builder-autonomy.util';
import { BuilderSettingsService } from '../service/builder-settings.service';
import { BuilderNotificationService } from '../service/builder-notification.service';
import { BuilderLessonCuratorService } from '../service/builder-lesson-curator.service';
import { BuilderExemplarService } from '../service/builder-exemplar.service';
import { BuilderMetricsService } from '../service/builder-metrics.service';
import { BuilderEpicService } from '../service/builder-epic.service';
import { BuilderResearchService } from '../service/builder-research.service';
import { BuilderCatalogService } from '../service/builder-catalog.service';
import { BuilderEvidenceLogService } from '../service/builder-evidence-log.service';
import { BuilderPrdVersionRepository } from '../repository/builder-prd.repository';
import { BuilderBuildRunRepository } from '../repository/builder-build.repository';
import {
  CreateBuilderMessageDto,
  CreateBuilderSessionDto,
  ListBuilderSessionsQueryDto,
  PatchBuilderPrdDto,
  DismissBuilderReviewFindingDto,
  RaiseBuilderBudgetDto,
  StartBuilderBuildDto,
  UpdateBuilderSessionDto,
  UpdateBuilderSettingsDto,
  ListBuilderLessonsQueryDto,
  UpdateBuilderLessonDto,
  BuilderResearchDto,
} from '../dto/builder.dto';
import {
  BUILDER_EVENT_PAGE_SIZE,
  BUILDER_SSE_PING_INTERVAL_MS,
  BUILDER_TURN_LOCK_PREFIX,
  BUILDER_TURN_LOCK_TTL_SECONDS,
  BUILDER_PR_AUTOMATION_TIMEBOX_MS,
} from '../constants/builder.constants';
import { BUILDER_REPOS } from '../constants/builder-repos.constants';

/**
 * Builder — the admin-facing half (JWT). The machine-facing pipeline that
 * build runners call back into is a separate controller class with its own
 * auth model, so the two never share a route table by accident.
 *
 * Gating follows the AI Lab pattern: a per-user feature toggle with the
 * platform-admin roles as the legacy escape hatch during the toggle rollout.
 */
@ApiTags('Builder')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'builder', version: '1' })
export class BuilderController {
  private readonly logger = LoggerService.getInstance(BuilderController.name);

  constructor(
    private readonly sessionService: BuilderSessionService,
    private readonly prdService: BuilderPrdService,
    private readonly knowledgeService: BuilderKnowledgeService,
    private readonly orchestratorService: BuilderInterviewOrchestratorService,
    private readonly buildService: BuilderBuildService,
    private readonly eventService: BuilderEventService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly settingsService: BuilderSettingsService,
    private readonly notificationService: BuilderNotificationService,
    private readonly curatorService: BuilderLessonCuratorService,
    private readonly exemplarService: BuilderExemplarService,
    private readonly metricsService: BuilderMetricsService,
    private readonly epicService: BuilderEpicService,
    private readonly researchService: BuilderResearchService,
    private readonly prdVersionRepository: BuilderPrdVersionRepository,
    private readonly runRepository: BuilderBuildRunRepository,
    private readonly redisService: RedisService,
    private readonly catalogService: BuilderCatalogService,
    private readonly evidenceLog: BuilderEvidenceLogService,
  ) {}

  @Post('sessions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Start a Builder session (PRD interview)' })
  createSession(
    @Body() dto: CreateBuilderSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.createSession(user.id, {
      title: dto.title,
      tenantId: user.tenantId ?? null,
    });
  }

  @Get('sessions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'List Builder sessions (shared across Builder users), newest first',
  })
  listSessions(
    @Query() query: ListBuilderSessionsQueryDto,
    @CurrentUser() user: TokenUser,
  ) {
    const createdBy = query.mine ? user.id : undefined;
    if (query.archived) {
      return this.sessionService.listArchivedSessions({
        createdBy,
        statuses: query.status,
        limit: query.limit ?? 25,
        offset: query.offset ?? 0,
      });
    }
    return this.sessionService.listSessions({
      statuses: query.status,
      createdBy,
    });
  }

  @Get('sessions/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Session with transcript, PRD draft and readiness rubric',
  })
  getSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.getSessionDetail(sessionId, user.id);
  }

  @Patch('sessions/:sessionId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Rename a session or set its repos / model',
  })
  updateSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: UpdateBuilderSessionDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.updateSession(sessionId, user.id, dto);
  }

  @Post('sessions/:sessionId/cancel')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Stop a session' })
  cancelSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.cancelSession(sessionId, user.id);
  }

  @Post('sessions/:sessionId/pull-requests/:pullRequestId/resume-automation')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Give a pull request that needs a person back to automation',
    description:
      'Clears the escalation and gives the pull request a fresh budget of ' +
      'review and fix rounds.',
  })
  resumePullRequestAutomation(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('pullRequestId', ParseUUIDPipe) pullRequestId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.pullRequestService.resumeAutomation(
      sessionId,
      pullRequestId,
      user.id,
    );
  }

  @Post('sessions/:sessionId/pull-requests/:pullRequestId/merge')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: "Merge one of this session's pull requests",
    description:
      'Reads the checks first and refuses anything that is not green; passes ' +
      "GitHub's own refusal through rather than forcing past it. The human " +
      'decision and the CI gate both survive — this removes the walk to ' +
      'another tab, not the review.',
  })
  mergePullRequest(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('pullRequestId', ParseUUIDPipe) pullRequestId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.pullRequestService.mergePullRequest(
      sessionId,
      pullRequestId,
      user.id,
    );
  }

  @Post('sessions/:sessionId/archive')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Hide a finished session from the default feed',
  })
  archiveSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.archiveSession(sessionId, user.id);
  }

  @Post('sessions/:sessionId/unarchive')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Restore an archived session to the default feed',
  })
  unarchiveSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.unarchiveSession(sessionId, user.id);
  }

  @Patch('sessions/:sessionId/prd')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Edit the PRD directly (RFC-6902); rejected while a build runs',
  })
  patchPrd(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: PatchBuilderPrdDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.patchPrd(
      sessionId,
      user.id,
      dto.ops,
      dto.changeSummary,
    );
  }

  @Post('sessions/:sessionId/prd/review/findings/:findingId/dismiss')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Dismiss a PRD review finding with the reason it is wrong; returns readiness',
  })
  dismissReviewFinding(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Param('findingId') findingId: string,
    @Body() dto: DismissBuilderReviewFindingDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.sessionService.dismissReviewFinding(
      sessionId,
      user.id,
      findingId,
      dto.reason,
    );
  }

  @Get('sessions/:sessionId/prd/versions')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'PRD version history, newest first' })
  async listPrdVersions(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    // Existence check first — the versions table is keyed by doc, not session.
    await this.sessionService.getSession(sessionId);
    const doc = await this.prdService.getOrCreateDoc(sessionId, user.id);
    return this.prdVersionRepository.listByDoc(doc.id);
  }

  @Get('repo-commands')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Repos Builder can work in, with their commands' })
  listRepoCommands() {
    return { repos: BUILDER_REPOS };
  }

  @Get('repo-maps')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Repo knowledge packs with their freshness (staleness display)',
  })
  async listRepoMaps() {
    const maps = await this.knowledgeService.listRepoMaps();
    return {
      maps: maps.map((map) => ({
        repo: map.repo,
        commitSha: map.commitSha,
        generatedAt: map.generatedAt,
        stats: map.stats,
      })),
    };
  }

  @Get('catalog')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'The platform map: reusable systems, per-repo catalog freshness, web/mobile twins and the modules no reuse line covers',
  })
  async getCatalog() {
    const [catalogs, twins, coverage] = await Promise.all([
      this.catalogService.listCatalogs(),
      this.catalogService.parityTwins(),
      this.catalogService.coverage(),
    ]);
    return {
      capabilities: this.catalogService.capabilities(),
      catalogs: catalogs.map((row) => ({
        repo: row.repo,
        commitSha: row.commitSha,
        generatedAt: row.generatedAt,
        stats: row.stats,
      })),
      twins,
      coverage,
    };
  }

  @Get('sessions/:sessionId/evidence')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'Every lookup this session made and what came back (the evidence log)',
  })
  async listEvidence(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.sessionService.getSession(sessionId);
    return { evidence: await this.evidenceLog.listBySession(sessionId) };
  }

  /* ── Builds ───────────────────────────────────────────────────────────── */

  @Post('sessions/:sessionId/start-build')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Dispatch a build run from the ready PRD' })
  async startBuild(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: StartBuilderBuildDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    return this.buildService.startBuild(session, user.id, dto);
  }

  /**
   * Draft the technical design from the ready PRD: a read-only designer run
   * with the session's repos checked out. The session's status does not move.
   */
  @Post('sessions/:sessionId/design')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Draft the technical design (read-only designer run)',
  })
  async startDesign(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    return this.buildService.startDesign(session, user.id);
  }

  @Post('sessions/:sessionId/design/approve')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Approve the technical design in review; builds are held to it from here',
  })
  async approveDesign(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    return this.buildService.approveDesign(session, user.id);
  }

  /**
   * Raise the session's ceiling, at any point in its life.
   *
   * VIEW_BUILDER is not enough: this authorises spend.
   */
  @Post('sessions/:sessionId/budget')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Raise the session spend ceiling',
  })
  async raiseBudget(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RaiseBuilderBudgetDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    return this.buildService.raiseBudget(session, user.id, dto.budgetUsd);
  }

  /**
   * Live spend and the ceiling. Polled by the session page while a build is
   * live — the session detail it loaded once cannot show a number that moves.
   */
  @Get('sessions/:sessionId/budget')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Live spend against the ceiling' })
  async getSessionBudget(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.sessionService.getSession(sessionId);
    return this.buildService.getSessionBudget(sessionId);
  }

  @Get('sessions/:sessionId/runs')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Build runs for a session, oldest first' })
  async listRuns(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.sessionService.getSession(sessionId);
    return this.runRepository.listBySession(sessionId);
  }

  @Get('runs/:runId/events')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'Build events after a cursor — the feed’s polling fallback',
  })
  async listRunEvents(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('afterSeq') afterSeq: string | undefined,
  ) {
    const run = await this.buildService.getRunOrFail(runId);
    // A run id that resolves to a deleted session must not serve its events.
    await this.sessionService.getSession(run.sessionId);
    const events = await this.eventService.listByRun(
      runId,
      Math.max(0, Number(afterSeq) || 0),
      BUILDER_EVENT_PAGE_SIZE,
    );
    return {
      events,
      lastSeq: events[events.length - 1]?.seq ?? (Number(afterSeq) || 0),
      runStatus: run.status,
    };
  }

  @Get('sessions/:sessionId/pull-requests')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Pull requests this session opened' })
  async listPullRequests(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.sessionService.getSession(sessionId);
    return this.pullRequestService.listBySession(sessionId);
  }

  @Get('sessions/:sessionId/pr-feedback')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'CI failures and review comments on this session’s PRs',
  })
  async listPrFeedback(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.sessionService.getSession(sessionId);
    return this.pullRequestService.listFeedback(sessionId);
  }

  /* ── Settings & notifications ─────────────────────────────────────────── */

  @Post('sessions/:sessionId/research')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Read the codebase and write the technical plan (or draft the whole PRD)',
  })
  async research(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: BuilderResearchDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    return this.researchService.run(
      session,
      user.id,
      dto.mode ?? 'technical_plan',
    );
  }

  /* ── Epic mode ──────────────────────────────────────────────────────── */

  @Get('sessions/:sessionId/milestones')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'The milestone series for an epic session' })
  async listMilestones(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.sessionService.getSession(sessionId);
    return this.epicService.listBySession(sessionId);
  }

  @Post('sessions/:sessionId/epic-plan')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Propose a milestone split for a large PRD. Nothing dispatches until it is confirmed.',
  })
  async proposeEpic(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    const doc = await this.prdService.getOrCreateDoc(sessionId, user.id);
    return this.epicService.propose(session, doc.draft);
  }

  @Post('sessions/:sessionId/epic-plan/confirm')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Accept the proposed split and start the first milestone',
  })
  async confirmEpic(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: StartBuilderBuildDto,
    @CurrentUser() user: TokenUser,
  ) {
    const session = await this.sessionService.getSession(sessionId);
    const milestones = await this.epicService.listBySession(sessionId);
    if (!milestones.length) {
      throw new NotFoundException(
        'This session has no proposed milestones to confirm.',
      );
    }
    return this.buildService.startBuild(session, user.id, dto);
  }

  /* ── The lesson library ─────────────────────────────────────────────── */

  @Get('lessons')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'The lesson library, with its curation state and counters',
  })
  listLessons(@Query() query: ListBuilderLessonsQueryDto) {
    return this.knowledgeService.listLessons(query);
  }

  @Patch('lessons/:lessonId')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Edit, retire or pin a lesson. A pinned lesson the curator may not touch.',
  })
  updateLesson(
    @Param('lessonId', ParseUUIDPipe) lessonId: string,
    @Body() dto: UpdateBuilderLessonDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.knowledgeService.updateLesson(lessonId, dto, user.id);
  }

  @Post('lessons/consolidate')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary: 'Run the consolidation pass now rather than waiting for the tick',
  })
  consolidateLessons() {
    return this.curatorService.consolidate(true);
  }

  @Get('scoreboard')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'Is Builder getting better — merge rate, rework and cost over time',
  })
  scoreboard(@Query('windowDays') windowDays?: string) {
    return this.metricsService.scoreboard(Number(windowDays) || 30);
  }

  @Get('pipeline-health')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary:
      'Where a run spends its time and money — per phase, gate and outcome',
  })
  pipelineHealth(@Query('windowDays') windowDays?: string) {
    return this.metricsService.pipelineHealth(Number(windowDays) || 30);
  }

  @Get('exemplars')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Past builds and how they turned out' })
  listExemplars() {
    return this.exemplarService.listRecent();
  }

  @Get('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({
    summary: 'The kill switch, concurrency ceiling and defaults',
  })
  async getSettings() {
    const settings = await this.settingsService.get();
    const autonomyLevel = autonomyLevelOf(settings);
    const trackRecord = await this.pullRequestService.trackRecord();
    // The next level is suggested only once it has been earned: a full window
    // of clean reviews that people then merged exactly as reviewed, with no
    // release that failed its health check (Stacks, "Progressive Delegation").
    const earned =
      trackRecord.mergedAsReviewed >= trackRecord.window &&
      trackRecord.unhealthyReleases === 0;
    return {
      ...settings,
      autonomyLevel,
      trackRecord,
      suggestedLevel: earned ? nextAutonomyLevel(autonomyLevel) : null,
      automationTimeboxMs: BUILDER_PR_AUTOMATION_TIMEBOX_MS,
    };
  }

  @Patch('settings')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({ summary: 'Update Builder settings' })
  updateSettings(
    @Body() dto: UpdateBuilderSettingsDto,
    @CurrentUser() user: TokenUser,
  ) {
    return this.settingsService.update(
      {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.maxConcurrentBuilds !== undefined
          ? { maxConcurrentBuilds: dto.maxConcurrentBuilds }
          : {}),
        ...(dto.defaultBudgetUsd !== undefined
          ? { defaultBudgetUsd: String(dto.defaultBudgetUsd) }
          : {}),
        ...(dto.maxRunnerMinutes !== undefined
          ? { maxRunnerMinutes: dto.maxRunnerMinutes || null }
          : {}),
        ...(dto.autoFixEnabled !== undefined
          ? { autoFixEnabled: dto.autoFixEnabled }
          : {}),
        ...(dto.autoReviewEnabled !== undefined
          ? { autoReviewEnabled: dto.autoReviewEnabled }
          : {}),
        ...(dto.autoApproveEnabled !== undefined
          ? { autoApproveEnabled: dto.autoApproveEnabled }
          : {}),
        ...(dto.autoMergeEnabled !== undefined
          ? { autoMergeEnabled: dto.autoMergeEnabled }
          : {}),
        ...(dto.autoReleaseEnabled !== undefined
          ? { autoReleaseEnabled: dto.autoReleaseEnabled }
          : {}),
        ...(dto.maxFixRunsPerPr !== undefined
          ? { maxFixRunsPerPr: dto.maxFixRunsPerPr }
          : {}),
        ...(dto.plannerModel !== undefined
          ? { plannerModel: dto.plannerModel || null }
          : {}),
        ...(dto.coderModel !== undefined
          ? { coderModel: dto.coderModel || null }
          : {}),
        ...(dto.verifierModel !== undefined
          ? { verifierModel: dto.verifierModel || null }
          : {}),
        ...(dto.validatedTurns !== undefined
          ? { validatedTurns: dto.validatedTurns }
          : {}),
        ...(dto.situationBrief !== undefined
          ? { situationBrief: dto.situationBrief }
          : {}),
        ...(dto.maxPrAutomationUsd !== undefined
          ? {
              maxPrAutomationUsd: dto.maxPrAutomationUsd
                ? String(dto.maxPrAutomationUsd)
                : null,
            }
          : {}),
        // The level sets the switches, and wins over any given alongside it.
        ...(dto.autonomyLevel
          ? switchesForAutonomyLevel(dto.autonomyLevel)
          : {}),
      },
      user.id,
    );
  }

  @Get('notifications')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Your Builder inbox' })
  async listNotifications(@CurrentUser() user: TokenUser) {
    const [notifications, unread] = await Promise.all([
      this.notificationService.listForAdmin(user.id),
      this.notificationService.countUnread(user.id),
    ]);
    return { notifications, unread };
  }

  @Post('notifications/:id/read')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Mark one notification read' })
  async markNotificationRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: TokenUser,
  ) {
    await this.notificationService.markRead(id, user.id);
    return { ok: true };
  }

  @Post('notifications/read-all')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.VIEW_BUILDER],
  })
  @ApiOperation({ summary: 'Mark every notification read' })
  async markAllNotificationsRead(@CurrentUser() user: TokenUser) {
    await this.notificationService.markAllRead(user.id);
    return { ok: true };
  }

  @Post('sessions/:sessionId/messages/stream')
  @RequireFeatureToggle(FeatureToggleKey.BUILDER, {
    permissions: [PERMISSIONS.EDIT_BUILDER],
  })
  @ApiOperation({
    summary:
      'Stream one interview turn (SSE: token / tool_call / tool_result / question / prd_draft / readiness / error / done)',
  })
  async streamMessage(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: CreateBuilderMessageDto,
    @CurrentUser() user: TokenUser,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Disconnect tracking + write guard. `res` 'close' with !writableEnded is
    // the real disconnect signal — `req` 'close' fires on request-body
    // completion in modern Node and would false-positive on every turn.
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableEnded) {
        clientGone = true;
      }
    });
    const safeWrite = (event: string, data: Record<string, any>): void => {
      if (clientGone || res.writableEnded || res.destroyed) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        clientGone = true;
      }
    };

    // Per-session turn mutex: concurrent streams would interleave tool loops
    // over one transcript and one PRD.
    const lockKey = `${BUILDER_TURN_LOCK_PREFIX}:${sessionId}`;
    const locked = await this.redisService.acquireLock(
      lockKey,
      BUILDER_TURN_LOCK_TTL_SECONDS,
    );
    if (!locked) {
      safeWrite('error', {
        code: 'turn_in_progress',
        message: 'Another turn is already streaming for this session',
      });
      res.end();
      return;
    }

    // Keep-alive: a turn that spends 40s researching the codebase emits
    // nothing, which trips proxy idle timeouts. Clients ignore these.
    const heartbeat = setInterval(
      () => safeWrite('ping', { at: Date.now() }),
      BUILDER_SSE_PING_INTERVAL_MS,
    );

    try {
      try {
        const frames = this.orchestratorService.streamTurn(
          sessionId,
          dto,
          user.id,
        );
        for await (const frame of frames) {
          safeWrite(frame.event, frame.data);
        }
      } catch (error) {
        // Errors inside the generator already surface as `error` frames; this
        // catches pre-stream failures (404/403, model auth). A missing session
        // is tagged so the client can re-create and replay once instead of
        // dead-ending.
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof NotFoundException
            ? 'session_not_found'
            : 'stream_failed';
        this.logger.error(
          `Builder stream failed for session ${sessionId}: ${message}`,
        );
        safeWrite('error', { code, message });
      }
    } finally {
      clearInterval(heartbeat);
      try {
        await this.redisService.releaseLock(lockKey);
      } catch (error) {
        this.logger.warn(
          `Failed to release Builder turn lock for session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
