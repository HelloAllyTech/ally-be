import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from '../service/analytics.service';
import { CohortAnalyticsService } from '../service/cohort-analytics.service';
import { HighlightsAnalyticsService } from '../service/highlights-analytics.service';
import { LanguageAnalyticsService } from '../service/language-analytics.service';
import { LanguageJudgeService } from '../service/language-judge.service';
import { PlatformAnalyticsService } from '../service/platform-analytics.service';
import { ScribeAnalyticsService } from '../service/scribe-analytics.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  CreateDashboardDto,
  DashboardIdParamDto,
  CounselorStatsQueryDto,
  CounselorStatsResponseDto,
  UpdateDashboardDto,
  DashboardResponseDTO,
  CreateDashboardResponseDto,
} from '../dto/analytics.dto';
import {
  AgentJoinReliabilityQueryDto,
  AgentJoinReliabilityResponseDto,
  AnalyticsOverviewQueryDto,
  AnalyticsOverviewResponseDto,
  ConversationDriftQueryDto,
  ConversationDriftResponseDto,
  DriftBackfillJobDto,
  LanguageBackfillJobDto,
  LanguageEvalReferenceDto,
  LanguageQualityQueryDto,
  LanguageQualityResponseDto,
  SetLanguageEvalReferenceDto,
  StartDriftBackfillDto,
  StartLanguageBackfillDto,
  StartLatencyQueryDto,
  StartLatencyResponseDto,
  TokenConsumptionQueryDto,
  TokenConsumptionResponseDto,
  VoiceLatencyQueryDto,
  VoiceLatencyResponseDto,
} from '../dto/platform-analytics.dto';
import {
  AnalyticsHighlightsQueryDto,
  AnalyticsHighlightsResponseDto,
} from '../dto/highlights-analytics.dto';
import {
  CohortRetentionQueryDto,
  CohortRetentionResponseDto,
} from '../dto/cohort-analytics.dto';
import {
  ScribeAnalyticsQueryDto,
  ScribeOverviewResponseDto,
  ScribeSummaryFailureResponseDto,
} from '../dto/scribe-analytics.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';
import {
  UserRole,
  SUPER_ADMIN_ROLES,
} from 'src/common/constants/user.constants';

@ApiTags('Analytics')
@Controller('v1/analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly highlightsAnalyticsService: HighlightsAnalyticsService,
    private readonly cohortAnalyticsService: CohortAnalyticsService,
    private readonly platformAnalyticsService: PlatformAnalyticsService,
    private readonly scribeAnalyticsService: ScribeAnalyticsService,
    private readonly languageJudgeService: LanguageJudgeService,
    private readonly languageAnalyticsService: LanguageAnalyticsService,
  ) {}

  @Get('overview')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Platform analytics overview (super-admin)',
    description:
      'Platform-wide metrics: user growth, active users (DAU/WAU/MAU), ' +
      'simulations completed, weekly retention and users by role, plus a KPI ' +
      'summary. Window selected via `range` or an explicit `from`/`to`; ' +
      '`compare=prev` adds the equal-length preceding window as the basis for ' +
      'KPI deltas. NOTE: the summary scalars cover the SELECTED window — they ' +
      'previously covered a fixed rolling 30 days and the current ISO week ' +
      'regardless of the picker, hence the `activeUsers` / ' +
      '`simulationsCompleted` renames.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics overview retrieved successfully',
    type: AnalyticsOverviewResponseDto,
  })
  async getOverview(
    @Query() query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewResponseDto> {
    return this.platformAnalyticsService.getOverview(query);
  }

  @Get('highlights')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Leadership highlights (super-admin)',
    description:
      'Leadership KPI aggregates NOT already served by /overview or ' +
      '/scribe/overview: org adoption (active orgs + top orgs by completed ' +
      'simulations), practice minutes, roleplay quality trend (composite ' +
      'evaluation score), learner CSAT trend, learning-track funnel and AI ' +
      'cost per completed simulation. Bucket granularity follows the `range` ' +
      'param (30d -> day, 90d -> week, 12m -> month) unless overridden. ' +
      'Supports an explicit `from`/`to` window, `compare=prev` for the ' +
      'equal-length preceding window (the basis for KPI deltas), and ' +
      '`tenantId` to narrow to one org — see `scoping.unscopedSections` for the ' +
      'aggregates that stay platform-wide regardless.',
  })
  @ApiResponse({
    status: 200,
    description: 'Highlights aggregates retrieved successfully',
    type: AnalyticsHighlightsResponseDto,
  })
  async getHighlights(
    @Query() query: AnalyticsHighlightsQueryDto,
  ): Promise<AnalyticsHighlightsResponseDto> {
    return this.highlightsAnalyticsService.getHighlights(query);
  }

  @Get('cohort-retention')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Monthly learner cohort retention (super-admin)',
    description:
      'For each month, the learner accounts created in it, followed forward: ' +
      'how many of that cohort practised at least N minutes in each later ' +
      'calendar month. All three "active user" definitions (10 / 50 / 100 ' +
      'minutes per month) are returned in the same response so the client can ' +
      'switch definition without a refetch and the three can never disagree ' +
      'about the denominator. ALL-TIME and month-grained by design — this ' +
      'endpoint takes no `range`/`bucket`/`from`/`to`, because a cohort is only ' +
      'readable once it has been followed for several months. Month 0 is not ' +
      'measured: the signup month is the cohort itself, 100% by definition. ' +
      '`tenantId` narrows both the population and the activity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cohort retention grid retrieved successfully',
    type: CohortRetentionResponseDto,
  })
  async getCohortRetention(
    @Query() query: CohortRetentionQueryDto,
  ): Promise<CohortRetentionResponseDto> {
    return this.cohortAnalyticsService.getCohortRetention(query);
  }

  @Get('voice-latency')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Voice-to-voice latency trend (super-admin)',
    description:
      'Per-bucket avg / p50 / p95 voice-to-voice latency from ' +
      'scenario_session_turn_metrics, split by `source` (live pipeline vs ' +
      'historical transcript). Bucket granularity follows the `range` param ' +
      '(30d -> day, 90d -> week, 12m -> month).',
  })
  @ApiResponse({
    status: 200,
    description: 'Voice-to-voice latency trend retrieved successfully',
    type: VoiceLatencyResponseDto,
  })
  async getVoiceLatency(
    @Query() query: VoiceLatencyQueryDto,
  ): Promise<VoiceLatencyResponseDto> {
    return this.platformAnalyticsService.getVoiceLatency(query);
  }

  @Get('agent-join-reliability')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Agent-join reliability trend (super-admin)',
    description:
      'Per-bucket agent-join failure rate + dispatch->join latency (p50/p95) ' +
      'from the session lifecycle log, plus the overall session outcome mix. ' +
      'Bucket granularity follows the `range` param (30d -> day, 90d -> week, ' +
      '12m -> month).',
  })
  @ApiResponse({
    status: 200,
    description: 'Agent-join reliability trend retrieved successfully',
    type: AgentJoinReliabilityResponseDto,
  })
  async getAgentJoinReliability(
    @Query() query: AgentJoinReliabilityQueryDto,
  ): Promise<AgentJoinReliabilityResponseDto> {
    return this.platformAnalyticsService.getAgentJoinReliability(query);
  }

  @Get('start-latency')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Simulation start-latency trend (super-admin)',
    description:
      'Per-bucket avg / p50 / p95 simulation start latency ("time to first ' +
      'word": agent job start -> the agent begins its opening dialogue) from ' +
      'scenario_session_start_metrics, with the mean of each startup segment ' +
      '(configure / initialize / connect / prep) for a stacked breakdown. Split ' +
      'by `source` (live pipeline vs historical transcript). Bucket granularity ' +
      'follows the `range` param (30d -> day, 90d -> week, 12m -> month).',
  })
  @ApiResponse({
    status: 200,
    description: 'Simulation start-latency trend retrieved successfully',
    type: StartLatencyResponseDto,
  })
  async getStartLatency(
    @Query() query: StartLatencyQueryDto,
  ): Promise<StartLatencyResponseDto> {
    return this.platformAnalyticsService.getStartLatency(query);
  }

  @Get('conversation-drift')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Conversation drift analytics (super-admin)',
    description:
      'Drift rate per language (primary KPI) plus attribution mix (STT vs LLM ' +
      'vs cascade vs context) and failure-mode breakdown, over ' +
      'turn_drift_judgment. Sliceable by language / scenario / model / provider ' +
      '/ promptVersion for experiment comparison.',
  })
  @ApiResponse({ status: 200, type: ConversationDriftResponseDto })
  async getConversationDrift(
    @Query() query: ConversationDriftQueryDto,
  ): Promise<ConversationDriftResponseDto> {
    return this.platformAnalyticsService.getConversationDrift(
      query.range ?? '90d',
      {
        language: query.language,
        scenarioId: query.scenarioId,
        scenarioVersionId: query.scenarioVersionId,
        llmModel: query.llmModel,
        llmProvider: query.llmProvider,
        promptVersion: query.promptVersion,
      },
    );
  }

  @Get('token-consumption')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'AI token consumption by model & task (super-admin)',
    description:
      'Total LLM token usage over `range`, grouped by (model × task) and ' +
      'converted to an estimated USD cost via the pricing table. Tokens are ' +
      'the source of truth; `priced=false` flags models with no pricing entry.',
  })
  @ApiResponse({ status: 200, type: TokenConsumptionResponseDto })
  async getTokenConsumption(
    @Query() query: TokenConsumptionQueryDto,
  ): Promise<TokenConsumptionResponseDto> {
    return this.platformAnalyticsService.getTokenConsumption(query);
  }

  @Get('scribe/overview')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Scribe-session analytics overview (super-admin)',
    description:
      'Platform-wide scribe (counselor session) metrics over `range`: total ' +
      'sessions, summary success rate, sessions-created trend, outcome ' +
      'breakdown by summaryStatus, and mode split (SCRIBE upload vs DICTATION ' +
      'live). Derived from the `chats` table (cross-tenant).',
  })
  @ApiResponse({ status: 200, type: ScribeOverviewResponseDto })
  async getScribeOverview(
    @Query() query: ScribeAnalyticsQueryDto,
  ): Promise<ScribeOverviewResponseDto> {
    return this.scribeAnalyticsService.getOverview(query);
  }

  @Get('scribe/summary-failures')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Scribe summary-generation failure analytics (super-admin)',
    description:
      'Summary-failure rate over `range` (FAILED / (SUCCESS + FAILED), ' +
      'excluding no-audio and in-flight), the failure-rate trend, failures by ' +
      'pipeline stage, retryable-vs-terminal split, and timeout-vs-other split. ' +
      'Derived from the `chats` table (cross-tenant).',
  })
  @ApiResponse({ status: 200, type: ScribeSummaryFailureResponseDto })
  async getScribeSummaryFailures(
    @Query() query: ScribeAnalyticsQueryDto,
  ): Promise<ScribeSummaryFailureResponseDto> {
    return this.scribeAnalyticsService.getSummaryFailures(query);
  }

  @Post('conversation-drift/backfill')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Re-run the drift backfill over the last N days (super-admin)',
    description:
      'Kicks off an async drift-judge backfill on ally-ai over sessions created ' +
      'in the last `sinceDays` days (default 90 ≈ 3 months), judging only ' +
      'sessions not already judged. Returns a job id; poll the status endpoint.',
  })
  @ApiResponse({ status: 202, type: DriftBackfillJobDto })
  async startDriftBackfill(
    @Body() body: StartDriftBackfillDto,
  ): Promise<DriftBackfillJobDto> {
    return this.platformAnalyticsService.startDriftBackfill(
      body.sinceDays ?? 90,
    );
  }

  @Get('conversation-drift/backfill/:jobId')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({ summary: 'Drift backfill job status (super-admin)' })
  @ApiResponse({ status: 200, type: DriftBackfillJobDto })
  async driftBackfillStatus(
    @Param('jobId') jobId: string,
  ): Promise<DriftBackfillJobDto> {
    return this.platformAnalyticsService.getDriftBackfillStatus(jobId);
  }

  @Get('language-quality')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Language-quality evaluation dashboard (super-admin)',
    description:
      'Categorized, severity-weighted language error rates per 100 turns — ' +
      'by dimension (severity-stacked), by language, by category — plus the ' +
      'prompt-vs-model isolation split and a recent error log. Aggregated ' +
      'from the same per-session judgment rows shown in Roleplay Session ' +
      'Logs. Pinned to the latest judge version; no scalar quality scores.',
  })
  @ApiResponse({ status: 200, type: LanguageQualityResponseDto })
  async getLanguageQuality(
    @Query() query: LanguageQualityQueryDto,
  ): Promise<LanguageQualityResponseDto> {
    return this.languageAnalyticsService.getLanguageQuality(query);
  }

  @Get('language-quality/reference')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'The pinned reference experiment (super-admin)',
    description:
      'FR13: the saved filter tuple all language-quality deltas are read against.',
  })
  @ApiResponse({ status: 200, type: LanguageEvalReferenceDto })
  async getLanguageReference(): Promise<LanguageEvalReferenceDto | null> {
    return this.languageAnalyticsService.getReference();
  }

  @Post('language-quality/reference')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Pin a reference experiment (super-admin)',
    description:
      'Saves the given filter tuple ({language?, scenarioVersionId?, ' +
      'promptVersion?, llmModel?}) as THE pinned reference; unpins any ' +
      'previous one. Deltas on the Language tab are read against it.',
  })
  @ApiResponse({ status: 201, type: LanguageEvalReferenceDto })
  async setLanguageReference(
    @Body() body: SetLanguageEvalReferenceDto,
  ): Promise<LanguageEvalReferenceDto | null> {
    return this.languageAnalyticsService.setReference(body);
  }

  @Post('language-quality/backfill')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Run the language-quality judge backfill (super-admin)',
    description:
      'Kicks off an async language-quality judge backfill on ally-ai over ' +
      'sessions created in the last `sinceDays` days (default 90), judging ' +
      'only sessions not already judged. Writes per-session denominator rows ' +
      'and per-error annotations (read raw by Roleplay Session Logs; ' +
      'aggregated by the analytics dashboard). Returns a job id to poll.',
  })
  @ApiResponse({ status: 202, type: LanguageBackfillJobDto })
  async startLanguageBackfill(
    @Body() body: StartLanguageBackfillDto,
  ): Promise<LanguageBackfillJobDto> {
    // rejudge=true re-runs already-judged sessions (rubric/metric iteration);
    // default only judges new ones.
    return this.languageJudgeService.startBackfill(
      body.sinceDays ?? 90,
      !body.rejudge,
    );
  }

  @Get('language-quality/backfill/:jobId')
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Language-quality backfill job status (super-admin)',
  })
  @ApiResponse({ status: 200, type: LanguageBackfillJobDto })
  async languageBackfillStatus(
    @Param('jobId') jobId: string,
  ): Promise<LanguageBackfillJobDto> {
    const job = await this.languageJudgeService.getJob(jobId);
    if (!job) {
      return {
        jobId,
        status: 'error',
        total: 0,
        processed: 0,
        judged: 0,
        errorAnnotations: 0,
        skipped: 0,
        error: 'job not found (expired or unknown)',
      };
    }
    return job;
  }

  @ApiOperation({ summary: 'Get all dashboards' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of all dashboards',
    type: DashboardResponseDTO,
    isArray: true,
  })
  @Get('dashboard/all')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  async getAllDashboards(): Promise<DashboardResponseDTO[]> {
    return this.analyticsService.getAllDashboards();
  }

  @Get('dashboard/:externalId')
  @AuthPermissions([PERMISSIONS.VIEW_ANALYTICS_DASHBOARD_URL])
  getDashboardUrl(@Param() { externalId }: DashboardIdParamDto) {
    return this.analyticsService.getDashboardUrl(externalId);
  }

  @Post('dashboard/:externalId/refresh')
  @UseGuards(JwtAuthGuard)
  refreshDashboardUrl(@Param() { externalId }: DashboardIdParamDto) {
    return this.analyticsService.refreshDashboardUrl(externalId);
  }

  @Post('dashboard')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  createDashboard(
    @Body() dashboard: CreateDashboardDto,
  ): Promise<CreateDashboardResponseDto> {
    return this.analyticsService.createDashboard(dashboard);
  }

  @Get('dashboard')
  @AuthPermissions([PERMISSIONS.VIEW_ANALYTICS_DASHBOARD])
  getDashboards(@Req() req: { user: { id: number } }) {
    return this.analyticsService.getDashboards(req.user.id);
  }

  @ApiOperation({ summary: 'Update a dashboard' })
  @ApiParam({
    name: 'dashboardId',
    type: String,
    description: 'The ID of the dashboard to update',
  })
  @ApiBody({ type: UpdateDashboardDto })
  @Patch('dashboard/:dashboardId')
  @AuthPermissions([PERMISSIONS.EDIT_ANALYTICS_DASHBOARD])
  updateDashboard(
    @Param('dashboardId', ParseUUIDPipe) dashboardId: string,
    @Body() updateDashboardDto: UpdateDashboardDto,
  ) {
    return this.analyticsService.updateDashboard(
      dashboardId,
      updateDashboardDto,
    );
  }

  @AuthRoles(UserRole.COUNSELOR)
  @Get('counselor-stats')
  @ApiOperation({
    summary: 'Get counselor statistics',
    description:
      'Fetch counselor listening and sharing duration statistics with optional date range for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Counselor statistics retrieved successfully',
    type: [CounselorStatsResponseDto],
  })
  async getCounselorStats(
    @Query() queryParams: CounselorStatsQueryDto,
    @Req() req: { user: { id: number } },
  ): Promise<CounselorStatsResponseDto> {
    return this.analyticsService.getCounselorStats(queryParams, req.user.id);
  }
}
