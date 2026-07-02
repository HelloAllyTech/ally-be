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
  AnalyticsOverviewQueryDto,
  AnalyticsOverviewResponseDto,
  ConversationDriftQueryDto,
  ConversationDriftResponseDto,
  DriftBackfillJobDto,
  StartDriftBackfillDto,
  StartLatencyQueryDto,
  StartLatencyResponseDto,
  TokenConsumptionQueryDto,
  TokenConsumptionResponseDto,
  VoiceLatencyQueryDto,
  VoiceLatencyResponseDto,
} from '../dto/platform-analytics.dto';
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
import { UserRole } from 'src/common/constants/user.constants';

@ApiTags('Analytics')
@Controller('v1/analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly platformAnalyticsService: PlatformAnalyticsService,
    private readonly scribeAnalyticsService: ScribeAnalyticsService,
  ) {}

  @Get('overview')
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Platform analytics overview (super-admin)',
    description:
      'Platform-wide metrics: user growth, active users (DAU/WAU/MAU), ' +
      'simulations completed, weekly retention and users by role, plus a KPI ' +
      'summary. Time window selected via the `range` query param.',
  })
  @ApiResponse({
    status: 200,
    description: 'Analytics overview retrieved successfully',
    type: AnalyticsOverviewResponseDto,
  })
  async getOverview(
    @Query() query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewResponseDto> {
    return this.platformAnalyticsService.getOverview(query.range ?? '30d');
  }

  @Get('voice-latency')
  @AuthRoles(UserRole.SUPER_ADMIN)
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
    return this.platformAnalyticsService.getVoiceLatency(
      query.range ?? '90d',
      query.bucket,
      query.language,
    );
  }

  @Get('start-latency')
  @AuthRoles(UserRole.SUPER_ADMIN)
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
    return this.platformAnalyticsService.getStartLatency(
      query.range ?? '90d',
      query.bucket,
      query.language,
    );
  }

  @Get('conversation-drift')
  @AuthRoles(UserRole.SUPER_ADMIN)
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
  @AuthRoles(UserRole.SUPER_ADMIN)
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
    return this.platformAnalyticsService.getTokenConsumption(
      query.range ?? '30d',
    );
  }

  @Get('scribe/overview')
  @AuthRoles(UserRole.SUPER_ADMIN)
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
    return this.scribeAnalyticsService.getOverview(query.range ?? '30d');
  }

  @Get('scribe/summary-failures')
  @AuthRoles(UserRole.SUPER_ADMIN)
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
    return this.scribeAnalyticsService.getSummaryFailures(query.range ?? '30d');
  }

  @Post('conversation-drift/backfill')
  @AuthRoles(UserRole.SUPER_ADMIN)
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
  @AuthRoles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Drift backfill job status (super-admin)' })
  @ApiResponse({ status: 200, type: DriftBackfillJobDto })
  async driftBackfillStatus(
    @Param('jobId') jobId: string,
  ): Promise<DriftBackfillJobDto> {
    return this.platformAnalyticsService.getDriftBackfillStatus(jobId);
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
