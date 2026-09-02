import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from '../service/analytics.service';
import { ActivationAnalyticsService } from '../service/activation-analytics.service';
import { CoachingLoopAnalyticsService } from '../service/coaching-loop-analytics.service';
import { CohortAnalyticsService } from '../service/cohort-analytics.service';
import { CompetencyMapAnalyticsService } from '../service/competency-map-analytics.service';
import { CompletionRateAnalyticsService } from '../service/completion-rate-analytics.service';
import { LanguageMixAnalyticsService } from '../service/language-mix-analytics.service';
import { OrgHealthAnalyticsService } from '../service/org-health-analytics.service';
import { OrgSessionDistributionAnalyticsService } from '../service/org-session-distribution-analytics.service';
import { LearnerKpisAnalyticsService } from '../service/learner-kpis-analytics.service';
import { ScenarioUsageAnalyticsService } from '../service/scenario-usage-analytics.service';
import { QualityDistributionAnalyticsService } from '../service/quality-distribution-analytics.service';
import { ScribeAdoptionAnalyticsService } from '../service/scribe-adoption-analytics.service';
import { SkillGrowthAnalyticsService } from '../service/skill-growth-analytics.service';
import { TrackDropoffAnalyticsService } from '../service/track-dropoff-analytics.service';
import { UsageLevelAnalyticsService } from '../service/usage-level-analytics.service';
import { CertificationAnalyticsService } from '../service/certification-analytics.service';
import { RoleplayVolumeAnalyticsService } from '../service/roleplay-volume-analytics.service';
import { RoadmapDeliveryAnalyticsService } from '../service/roadmap-delivery-analytics.service';
import { HighlightsAnalyticsService } from '../service/highlights-analytics.service';
import { LanguageAnalyticsService } from '../service/language-analytics.service';
import { GlossaryEffectAnalyticsService } from '../service/glossary-effect-analytics.service';
import {
  GlossaryEffectQueryDto,
  GlossaryEffectResponseDto,
} from '../dto/glossary-effect-analytics.dto';
import {
  WeakMetricsQueryDto,
  WeakMetricsResponseDto,
} from '../dto/weak-metrics.dto';
import { WeakMetricsAnalyticsService } from '../service/weak-metrics-analytics.service';
import { FeedbackGroundednessJudgeService } from '../service/feedback-groundedness-judge.service';
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
  StartGroundednessBackfillDto,
  GroundednessBackfillJobDto,
  StartLanguageBackfillDto,
  StartLatencyQueryDto,
  StartLatencyResponseDto,
  TokenConsumptionQueryDto,
  TokenConsumptionResponseDto,
  VoiceLatencyQueryDto,
  VoiceLatencyResponseDto,
  VoiceLatencySessionsQueryDto,
  VoiceLatencySessionsSummaryQueryDto,
  ListVoiceLatencySessionsResponseDto,
  VoiceLatencySessionsSummaryResponseDto,
  VoiceLatencyByScenarioQueryDto,
  VoiceLatencyByScenarioResponseDto,
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
  UsageLevelQueryDto,
  UsageLevelResponseDto,
} from '../dto/usage-level-analytics.dto';
import {
  CertificationQueryDto,
  CertificationResponseDto,
} from '../dto/certification-analytics.dto';
import {
  RoleplayVolumeQueryDto,
  RoleplayVolumeResponseDto,
} from '../dto/roleplay-volume-analytics.dto';
import { RoadmapDeliveryResponseDto } from '../dto/roadmap-delivery-analytics.dto';
import {
  ScribeAnalyticsQueryDto,
  ScribeOverviewResponseDto,
  ScribeSummaryFailureResponseDto,
} from '../dto/scribe-analytics.dto';
// Endpoints behind the admin "Testing" tab — the staging surface for leadership
// charts that are candidates for Highlights. Named for what they measure rather
// than for the tab, so a chart that graduates does not drag a rename with it.
import {
  ActivationQueryDto,
  ActivationResponseDto,
} from '../dto/activation-analytics.dto';
import {
  CompletionRateQueryDto,
  CompletionRateResponseDto,
} from '../dto/completion-rate-analytics.dto';
import {
  LanguageMixQueryDto,
  LanguageMixResponseDto,
} from '../dto/language-mix-analytics.dto';
import {
  SkillGrowthLearnerSeriesResponseDto,
  SkillGrowthLearnersQueryDto,
  SkillGrowthLearnersResponseDto,
  SkillGrowthQueryDto,
  SkillGrowthResponseDto,
} from '../dto/skill-growth-analytics.dto';
import {
  QualityDistributionQueryDto,
  QualityDistributionResponseDto,
} from '../dto/quality-distribution-analytics.dto';
import {
  CompetencyMapQueryDto,
  CompetencyMapResponseDto,
} from '../dto/competency-map-analytics.dto';
import {
  TrackDropoffQueryDto,
  TrackDropoffResponseDto,
} from '../dto/track-dropoff-analytics.dto';
import {
  CoachingLoopQueryDto,
  CoachingLoopResponseDto,
} from '../dto/coaching-loop-analytics.dto';
import {
  OrgHealthQueryDto,
  OrgHealthResponseDto,
} from '../dto/org-health-analytics.dto';
import {
  OrgSessionDistributionQueryDto,
  OrgSessionDistributionResponseDto,
} from '../dto/org-session-distribution-analytics.dto';
import {
  LearnerKpisQueryDto,
  LearnerKpisResponseDto,
} from '../dto/learner-kpis-analytics.dto';
import {
  ScenarioUsageQueryDto,
  ScenarioUsageResponseDto,
} from '../dto/scenario-usage-analytics.dto';
import {
  ScribeAdoptionQueryDto,
  ScribeAdoptionResponseDto,
} from '../dto/scribe-adoption-analytics.dto';
import {
  UsageLadderQueryDto,
  UsageLadderResponseDto,
} from '../dto/usage-ladder-analytics.dto';
import {
  QualifiedSessionsQueryDto,
  QualifiedSessionsResponseDto,
  StickinessQueryDto,
  StickinessResponseDto,
} from '../dto/practice-depth-analytics.dto';
import {
  OrgEngagementQueryDto,
  OrgEngagementResponseDto,
} from '../dto/org-engagement-analytics.dto';
import {
  RoleplayCostQueryDto,
  RoleplayCostResponseDto,
} from '../dto/roleplay-cost-analytics.dto';
import {
  QualitySentimentQueryDto,
  QualitySentimentResponseDto,
} from '../dto/quality-sentiment-analytics.dto';
import {
  ChartPreferencesResponseDto,
  SaveChartPreferencesDto,
} from '../dto/chart-preference.dto';
import { UsageLadderAnalyticsService } from '../service/usage-ladder-analytics.service';
import { PracticeDepthAnalyticsService } from '../service/practice-depth-analytics.service';
import { OrgEngagementAnalyticsService } from '../service/org-engagement-analytics.service';
import { RoleplayCostAnalyticsService } from '../service/roleplay-cost-analytics.service';
import { QualitySentimentAnalyticsService } from '../service/quality-sentiment-analytics.service';
import { ChartPreferenceService } from '../service/chart-preference.service';
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
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { UserRole } from 'src/common/constants/user.constants';

@ApiTags('Analytics')
@Controller('v1/analytics')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly highlightsAnalyticsService: HighlightsAnalyticsService,
    private readonly cohortAnalyticsService: CohortAnalyticsService,
    private readonly usageLevelAnalyticsService: UsageLevelAnalyticsService,
    private readonly certificationAnalyticsService: CertificationAnalyticsService,
    private readonly roleplayVolumeAnalyticsService: RoleplayVolumeAnalyticsService,
    private readonly roadmapDeliveryAnalyticsService: RoadmapDeliveryAnalyticsService,
    private readonly platformAnalyticsService: PlatformAnalyticsService,
    private readonly scribeAnalyticsService: ScribeAnalyticsService,
    private readonly languageJudgeService: LanguageJudgeService,
    private readonly languageAnalyticsService: LanguageAnalyticsService,
    private readonly glossaryEffectAnalyticsService: GlossaryEffectAnalyticsService,
    private readonly weakMetricsAnalyticsService: WeakMetricsAnalyticsService,
    private readonly feedbackGroundednessJudgeService: FeedbackGroundednessJudgeService,
    private readonly activationAnalyticsService: ActivationAnalyticsService,
    private readonly completionRateAnalyticsService: CompletionRateAnalyticsService,
    private readonly languageMixAnalyticsService: LanguageMixAnalyticsService,
    private readonly skillGrowthAnalyticsService: SkillGrowthAnalyticsService,
    private readonly qualityDistributionAnalyticsService: QualityDistributionAnalyticsService,
    private readonly competencyMapAnalyticsService: CompetencyMapAnalyticsService,
    private readonly trackDropoffAnalyticsService: TrackDropoffAnalyticsService,
    private readonly coachingLoopAnalyticsService: CoachingLoopAnalyticsService,
    private readonly orgHealthAnalyticsService: OrgHealthAnalyticsService,
    private readonly orgSessionDistributionAnalyticsService: OrgSessionDistributionAnalyticsService,
    private readonly learnerKpisAnalyticsService: LearnerKpisAnalyticsService,
    private readonly scenarioUsageAnalyticsService: ScenarioUsageAnalyticsService,
    private readonly scribeAdoptionAnalyticsService: ScribeAdoptionAnalyticsService,
    private readonly usageLadderAnalyticsService: UsageLadderAnalyticsService,
    private readonly practiceDepthAnalyticsService: PracticeDepthAnalyticsService,
    private readonly orgEngagementAnalyticsService: OrgEngagementAnalyticsService,
    private readonly roleplayCostAnalyticsService: RoleplayCostAnalyticsService,
    private readonly qualitySentimentAnalyticsService: QualitySentimentAnalyticsService,
    private readonly chartPreferenceService: ChartPreferenceService,
  ) {}

  @Get('overview')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Leadership highlights (super-admin)',
    description:
      'Leadership KPI aggregates NOT already served by /overview or ' +
      '/scribe/overview: org adoption (active orgs + top orgs by completed ' +
      'simulations), practice minutes, mean/median/p95 simulation length, ' +
      'roleplay quality trend (composite ' +
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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

  @Get('certification')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Ally Certification attainment — the hero metric (super-admin)',
    description:
      'Distinct learners who have accumulated enough LIFETIME roleplay ' +
      'practice to hold an Ally Certification level, by the month they earned ' +
      'it and cumulatively over time, plus where the rest of the population ' +
      'stands against the threshold. L1 is 5,000 minutes. Minutes come from ' +
      'user_daily_scores.minutesPlayed — the sanctioned roleplay-activity ' +
      'source, net of paused time, and the same column the practice-minutes ' +
      'chart reads, so the two cannot disagree about what a minute is. The ' +
      'population is LEARNER-group accounts in non-test tenants. A learner is ' +
      'counted ONCE, in the month their running total first reached the ' +
      'threshold, so the monthly bars and the cumulative line say different ' +
      'things rather than one thing twice; the cumulative line is monotonic ' +
      'because a level is never lost. ALL-TIME and month-grained by design — ' +
      'this endpoint takes no `range`/`bucket`/`from`/`to`, because the ' +
      'threshold is a lifetime total and a window would change the metric ' +
      'rather than narrow it. The current month is flagged `partial`: more ' +
      'learners can still cross into it. `pipeline` bands the not-yet-' +
      'certified population by how far along it is — the leading indicator ' +
      'the crossings cannot be, since at this threshold a level takes many ' +
      'months to earn. `tenantId` narrows both the population and the activity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Certification attainment retrieved successfully',
    type: CertificationResponseDto,
  })
  async getCertification(
    @Query() query: CertificationQueryDto,
  ): Promise<CertificationResponseDto> {
    return this.certificationAnalyticsService.getCertification(query);
  }

  @Get('usage-ladder')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Learner usage ladder L1-L5 (super-admin)',
    description:
      'Learner progress up a five-rung ladder defined by LIFETIME roleplay ' +
      'minutes (L1 60, L2 300, L3 1200, L4 3000, L5 6000). Serves four ' +
      'readings of ONE definition, so they cannot disagree: learners newly ' +
      'reaching each rung per period (the "how many L3s did we produce" ' +
      'flow), the cumulative count holding each rung (the stock), the nested ' +
      'account-created -> L1 -> L5 funnel as of now, and the ladder itself. ' +
      'Minutes come from user_daily_scores.minutesPlayed, the same column the ' +
      'practice-minutes and certification charts read. Population is ' +
      'LEARNER-group accounts in non-test tenants. A learner is counted ONCE ' +
      'per rung, in the period they first reached it; a learner who climbed ' +
      'several rungs in one period appears in each of those series, so they ' +
      'must never be stacked. NOTE this ladder is a SEPARATE internal scale ' +
      'from the Ally Certification (one rung at 5,000 minutes) which its top ' +
      'rung brackets — never label a rung a certification or put the two on ' +
      'one axis. ALL-TIME by design: no range/from/to, because a lifetime ' +
      'threshold read over a window moves every crossing date. `grain` picks ' +
      'month or quarter only — the lowest rung takes weeks to reach, so a ' +
      'finer axis shows noise. The current period is flagged `partial`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Usage ladder retrieved successfully',
    type: UsageLadderResponseDto,
  })
  async getUsageLadder(
    @Query() query: UsageLadderQueryDto,
  ): Promise<UsageLadderResponseDto> {
    return this.usageLadderAnalyticsService.getUsageLadder(query);
  }

  @Get('practice-stickiness')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Practice stickiness funnel (super-admin)',
    description:
      'Of the learners who practised once, how many came back — and again. A ' +
      'step is a DAY carrying at least 5 minutes of practice, so several ' +
      'sessions in one evening count once: the funnel measures RETURNING, not ' +
      'session length. Steps are nested (at least N qualifying days) so the ' +
      'series can only narrow, and both conversions are returned — ' +
      '`ofPreviousPct` says where people are lost, `ofTopPct` says how rare ' +
      'deep engagement is. Ten explicit rungs plus a `beyondLastStep` tail so ' +
      'the funnel still reconciles with the population. ALL-TIME by design: ' +
      '"did they ever come back" cannot be asked of a window without ' +
      'reporting every recent signup as churned. Percentages are suppressed ' +
      '(null) when their denominator is below `minPopulation`, which is the ' +
      'same minimum-group-size rule the cohort grid uses; the counts stay.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stickiness funnel retrieved successfully',
    type: StickinessResponseDto,
  })
  async getPracticeStickiness(
    @Query() query: StickinessQueryDto,
  ): Promise<StickinessResponseDto> {
    return this.practiceDepthAnalyticsService.getStickiness(query);
  }

  @Get('qualified-sessions')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Roleplay sessions of 5+ minutes (super-admin)',
    description:
      'Completed roleplay sessions long enough to be practice — at least 5 ' +
      'minutes of call duration — per bucket, with ALL completed sessions ' +
      'beside them and the qualifying share. Both numbers because a fall in ' +
      'qualifying sessions means something different when total sessions fell ' +
      'with it (a quieter platform) than when they did not (sessions getting ' +
      'shorter, or failing early). Definition matches the tab\'s "completed ' +
      'simulation" exactly — eventStatus COMPLETED, timestamped by ' +
      'COALESCE(endedAt, createdAt), duration from ' +
      'scenario_session_details.callDuration in milliseconds net of paused ' +
      'time — so this reconciles with the completed-simulations and play-time ' +
      'charts. Sessions with no measurable duration are excluded from BOTH ' +
      'counts. Counts gap-fill to real zeros; the SHARE is null over a zero ' +
      'denominator. Supports range/bucket/from/to and tenantId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Qualifying session trend retrieved successfully',
    type: QualifiedSessionsResponseDto,
  })
  async getQualifiedSessions(
    @Query() query: QualifiedSessionsQueryDto,
  ): Promise<QualifiedSessionsResponseDto> {
    return this.practiceDepthAnalyticsService.getQualifiedSessions(query);
  }

  @Get('org-engagement')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Org engagement ladder and recent activity (super-admin)',
    description:
      'Three org-level panels: the nested Orgs-created -> L1 -> L4 funnel by ' +
      "TOTAL practice minutes summed across each org's learners (L1 500, L2 " +
      '5,000, L3 25,000, L4 100,000), how many orgs were active in the ' +
      'trailing `activityDays` (7/28/90, default 28) with that as a share, ' +
      'and a 12-month activity trend. NOTE the ladder measures SIZE as much ' +
      'as engagement — a large org clears L4 with token usage per seat while ' +
      'a small org practising hard may never leave L1 — so surfaces must not ' +
      'present it as adoption depth; org-health is where per-seat adoption is ' +
      'answered. "Active" is >=1 completed simulation, the same definition as ' +
      "the completed-simulations and top-orgs panels. The headline's " +
      'denominator counts only orgs that existed BEFORE the window opened: an ' +
      'org signed up three days ago has not had the chance to be inactive for ' +
      '28. The trend is per CALENDAR MONTH, a different measurement from the ' +
      'trailing headline rather than the same number. `tenantId` is accepted ' +
      'and IGNORED — every figure counts orgs, which one org cannot narrow — ' +
      'and the sections are named in scoping.unscopedSections.',
  })
  @ApiResponse({
    status: 200,
    description: 'Org engagement retrieved successfully',
    type: OrgEngagementResponseDto,
  })
  async getOrgEngagement(
    @Query() query: OrgEngagementQueryDto,
  ): Promise<OrgEngagementResponseDto> {
    return this.orgEngagementAnalyticsService.getOrgEngagement(query);
  }

  @Get('roleplay-cost')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'AI cost per 10 minutes of roleplay (super-admin)',
    description:
      'Estimated AI spend per 10 minutes of practice over time, split by area ' +
      '(live roleplay / feedback & summary / quiz grading) and by service ' +
      '(LLM / STT / TTS). Answers the unit-economics question ' +
      'cost-per-completed-simulation cannot: a simulation is not a fixed ' +
      'amount of product, so that figure moves when session length moves. ' +
      'Only LEARNER-CAUSED spend is in the numerator — judges, studio ' +
      'authoring, copilot, translation and internal tooling are reported ' +
      'separately as `excludedCostUsd` rather than dropped or shared out, ' +
      'because sharing them out would make practice look more expensive in a ' +
      'week when nobody practised but somebody authored ten scenarios. The ' +
      'denominator is the SAME practice-minutes measurement the ' +
      'practice-minutes chart uses. Every figure is an ESTIMATE priced at ' +
      'read time from a hand-maintained table that ignores prompt-cache ' +
      'discounts and negotiated rates; `unpricedCalls` counts calls with no ' +
      'pricing entry, which contribute $0 and make the total an ' +
      'understatement whenever it is non-zero. USD only. Ratios are null over ' +
      'a bucket with no practice — a ratio with no denominator is not zero. ' +
      'Platform-wide always: llm_usage is largely tenantless by design, so a ' +
      'tenant-filtered cost would be a fraction of real spend presented as ' +
      'the whole.',
  })
  @ApiResponse({
    status: 200,
    description: 'Roleplay unit cost retrieved successfully',
    type: RoleplayCostResponseDto,
  })
  async getRoleplayCost(
    @Query() query: RoleplayCostQueryDto,
  ): Promise<RoleplayCostResponseDto> {
    return this.roleplayCostAnalyticsService.getRoleplayCost(query);
  }

  @Get('quality-sentiment')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Roleplay quality vs learner sentiment (super-admin)',
    description:
      'The LLM-judge composite score and a PROXY NPS on one time axis, plus ' +
      'their correlation. Divergence is the signal: quality rising while ' +
      'sentiment falls means the scenarios got harder, both falling means ' +
      'something broke, and either number alone can be moved in the wrong ' +
      'direction unnoticed. IMPORTANT — the sentiment series is NOT NPS. Ally ' +
      'has never asked the 0-10 "would you recommend" question; this is ' +
      'derived from the 1-5 post-session rating by treating 5 as a promoter, ' +
      '4 as passive and <=3 as a detractor, then scoring it the way NPS is ' +
      'scored. It is comparable with itself over time and with nobody ' +
      "else's published score, and every surface must label it as a proxy " +
      '(see `proxyNote`). Both series are bucketed on the SESSION timestamp, ' +
      'not on when the evaluation or the rating was written, so asynchronous ' +
      'evaluation cannot slide the two lines against each other and ' +
      'manufacture divergence. Proxy NPS is null below `minResponses` — over ' +
      'a handful of responses one rating swings it by tens of points. Neither ' +
      'series is gap-filled with zeros: both are means, so a quiet bucket ' +
      'breaks the line rather than drawing a collapse. The correlation is ' +
      'computed over paired buckets only and suppressed below three of them, ' +
      'and is co-movement, NOT evidence of causation either way.',
  })
  @ApiResponse({
    status: 200,
    description: 'Quality vs sentiment retrieved successfully',
    type: QualitySentimentResponseDto,
  })
  async getQualitySentiment(
    @Query() query: QualitySentimentQueryDto,
  ): Promise<QualitySentimentResponseDto> {
    return this.qualitySentimentAnalyticsService.getQualitySentiment(query);
  }

  @Get('chart-preferences')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: "The caller's saved per-chart controls (super-admin)",
    description:
      'Every saved window/grain preference for the CALLING user, across all ' +
      'analytics tabs. The Highlights tab has no page-level date range — each ' +
      'chart owns its own controls — and this is what makes that choice ' +
      'survive a reload and follow the reader to another machine. Chart ids ' +
      'are client-owned strings, so a key the client no longer recognises is ' +
      'safe to ignore; a stored value that is no longer a legal range or ' +
      'grain is dropped on the way out rather than failing the request.',
  })
  @ApiResponse({
    status: 200,
    description: 'Chart preferences retrieved successfully',
    type: ChartPreferencesResponseDto,
  })
  async getChartPreferences(
    @Req() req: { user: { id: number } },
  ): Promise<ChartPreferencesResponseDto> {
    return this.chartPreferenceService.getForUser(req.user.id);
  }

  @Put('chart-preferences')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: "Save the caller's per-chart controls (super-admin)",
    description:
      'Upserts one row per chart for the calling user and returns the full ' +
      'saved set. A BATCH, so re-ranging three charts while reading is one ' +
      'round trip and a tab saving on unmount gets its one chance. NOT a ' +
      'replace-all: charts absent from the payload keep what they had, so a ' +
      'client that knows only about the tab on screen cannot wipe the saved ' +
      'state of every other tab. To clear one chart, send it with ' +
      '`range: null, bucket: null`.',
  })
  @ApiBody({ type: SaveChartPreferencesDto })
  @ApiResponse({
    status: 200,
    description: 'Chart preferences saved successfully',
    type: ChartPreferencesResponseDto,
  })
  async saveChartPreferences(
    @Req() req: { user: { id: number } },
    @Body() body: SaveChartPreferencesDto,
  ): Promise<ChartPreferencesResponseDto> {
    return this.chartPreferenceService.saveForUser(req.user.id, body);
  }

  @Get('usage-levels')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Monthly learner usage-level mix (super-admin)',
    description:
      'For each of the last 12 complete calendar months plus the current one, ' +
      'how many learners practised 0 / under 10 / 10-25 / 25-50 / 50-100 / ' +
      '100-500 / 500-1000 / 1000+ minutes in that month — the distribution ' +
      'behind the practice-minutes total, and whether the mix is shifting up. ' +
      'Bands are lower-inclusive and upper-exclusive, and are counted from a ' +
      "learner's monthly SUM of user_daily_scores.minutesPlayed. Both " +
      'denominators ("percentage of users" has two defensible readings — every ' +
      'registered learner, or only those who had ever practised) are returned ' +
      'per month from the same pass, so the client switches definition without a ' +
      'refetch and the two can never divide different numerators. MONTH-GRAINED ' +
      'and fixed-window by design — this endpoint takes no ' +
      '`range`/`bucket`/`from`/`to`, because a shift in a distribution is only ' +
      'visible across several months. The current month is flagged `partial`: it ' +
      'is still accruing minutes, so its low bands are overstated. `tenantId` ' +
      'narrows both the population and the activity.',
  })
  @ApiResponse({
    status: 200,
    description: 'Usage-level distribution retrieved successfully',
    type: UsageLevelResponseDto,
  })
  async getUsageLevels(
    @Query() query: UsageLevelQueryDto,
  ): Promise<UsageLevelResponseDto> {
    return this.usageLevelAnalyticsService.getUsageLevels(query);
  }

  @Get('roleplay-volume')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Learners by lifetime completed roleplays (super-admin)',
    description:
      'How the learner population splits across bands of COMPLETED ROLEPLAYS ' +
      'per learner: 0 / 1 / 2 / 3-5 / 6-10 / 11-25 / 26-50 / 51+. The ' +
      'distribution behind the roleplay volume charts — whether the volume comes ' +
      'from the whole population or from a handful of enthusiasts, and how large ' +
      'the never-started group is. Bands are inclusive on BOTH bounds (a count ' +
      'is discrete, so "3-5" means 3, 4 or 5), counted per learner from ' +
      'scenario_sessions with eventStatus COMPLETED attributed by counselorId. ' +
      'The zero band is a residual (`registeredLearners - learnersWithAny`) ' +
      'because a learner who never practised has no session row to count. ' +
      'ALL-TIME by design — this endpoint takes no `range`/`bucket`/`from`/`to`: ' +
      'a lifetime count is the quantity that answers the question, and over a ' +
      '30-day window nearly every learner would land in the lowest bands ' +
      'whatever their real depth. Counts, never percentages, are returned, with ' +
      '`minPopulationSize` as the floor below which a share must not be stated. ' +
      '`tenantId` narrows both the population and the sessions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Roleplay-volume distribution retrieved successfully',
    type: RoleplayVolumeResponseDto,
  })
  async getRoleplayVolume(
    @Query() query: RoleplayVolumeQueryDto,
  ): Promise<RoleplayVolumeResponseDto> {
    return this.roleplayVolumeAnalyticsService.getRoleplayVolume(query);
  }

  @Get('roadmap-delivery')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Votes shipped per month by owner (super-admin)',
    description:
      'Of the demand our own team voted for on the internal product roadmap, how ' +
      'much did we ship, when, and by whom. Each released opportunity — both ' +
      "`idea` and `bug` — is weighted by its VOTES, i.e. the board's " +
      '`priorityScore`: the sum over every voter and every monthly period, not ' +
      'just the release month, because an opportunity accrues backing while it ' +
      'waits and shipping it satisfies all of it. That makes a bar a measure of ' +
      'demand satisfied rather than of throughput, where a count would weigh a ' +
      '3-vote nicety like a 90-vote blocker. Bucketed on `releasedAt` by ' +
      "calendar month and split by owner (the linked account's current name, " +
      'else the legacy migrated string, else an Unassigned band), with the tail ' +
      'past `maxOwners` rolled into one band on an ALL-TIME ranking so no band ' +
      'moves when the reader filters. Both type splits come back in the one pass ' +
      'so the client switches between them without a refetch. ALL-TIME and ' +
      'MONTH-GRAINED by design — no `range`/`bucket`/`from`/`to`: the roadmap is ' +
      'a slow log where a quarter can hold a handful of releases. No `tenantId` ' +
      "either: the roadmap tables carry no tenant because the board is Ally's " +
      'own backlog. Crucially, `releasedAt` is stamped only on the TRANSITION ' +
      'into `released` and was never backfilled, so a large share of released ' +
      'rows have no date; those are excluded from `months` and reported in ' +
      '`undated` rather than dated from a proxy column, and a client MUST show ' +
      'that figure or the plotted total reads as the whole history.',
  })
  @ApiResponse({
    status: 200,
    description: 'Roadmap delivery retrieved successfully',
    type: RoadmapDeliveryResponseDto,
  })
  async getRoadmapDelivery(): Promise<RoadmapDeliveryResponseDto> {
    return this.roadmapDeliveryAnalyticsService.getRoadmapDelivery();
  }

  /* ------------------------------------------------------------------------ */
  /* Testing-tab endpoints                                                     */
  /*                                                                           */
  /* Originally candidates for the leadership Highlights tab, surfaced on a    */
  /* separate admin tab first so they could be judged against real data before */
  /* anything on Highlights changed; that Testing tab has since been folded    */
  /* into Highlights (see ally-web's HighlightsTab.tsx). Same guard as every   */
  /* sibling here — SUPER_ADMIN_ROLES, never a tighter tier than the rest of   */
  /* /v1/analytics.                                                            */
  /* ------------------------------------------------------------------------ */

  @Get('activation')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Activation: practising learners, funnel, time to first practice',
    description:
      'Three views of the same question — do new learners reach value, and how ' +
      'fast. (1) `practisingLearners`: distinct learners who completed a scored ' +
      'session per bucket, the candidate north-star series, gap-filled with real ' +
      'zeros because it is a count. (2) `funnel`: signed up -> started a sim -> ' +
      'completed one -> completed 3+, over the ALL-TIME learner population; the ' +
      'first stage is 100% by construction and is labelled as the denominator ' +
      'rather than presented as a measurement. (3) `timeToFirstPractice`: days ' +
      'from signup to first completed session as COUNTS per band (bands are ' +
      'inclusive on both ends, stated in `boundsNote`), with a residual ' +
      '"never practised" figure derived as registered minus activated — a ' +
      'learner who never practised has no first session to bucket. The funnel ' +
      'and the distribution ignore the window deliberately: both are questions ' +
      'about accounts, not about a period. Test organisations are excluded ' +
      'throughout, and preview/seed rooms do not count as sessions.',
  })
  @ApiResponse({
    status: 200,
    description: 'Activation metrics retrieved successfully',
    type: ActivationResponseDto,
  })
  async getActivation(
    @Query() query: ActivationQueryDto,
  ): Promise<ActivationResponseDto> {
    return this.activationAnalyticsService.getActivation(query);
  }

  @Get('completion-rate')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Started vs completed roleplays per period (super-admin)',
    description:
      'Of the sessions learners launched in each bucket, how many reached a ' +
      'scored ending — the leading friction signal, and the caveat behind every ' +
      'efficacy metric on the platform (those can only see sessions that ' +
      'finished). `completionRatePct` is NULL for a bucket with no launches: a ' +
      'rate over a zero denominator is undefined, not 0%, and a fabricated zero ' +
      'here would be the most flattering possible way to be wrong. The counts ' +
      'are gap-filled so the axis stays a real calendar.',
  })
  @ApiResponse({
    status: 200,
    description: 'Completion rate retrieved successfully',
    type: CompletionRateResponseDto,
  })
  async getCompletionRate(
    @Query() query: CompletionRateQueryDto,
  ): Promise<CompletionRateResponseDto> {
    return this.completionRateAnalyticsService.getCompletionRate(query);
  }

  @Get('language-mix')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Completed sessions by language per period (super-admin)',
    description:
      'Which languages carry practice, and whether the mix is shifting — the ' +
      'input to language investment decisions. VOLUME only: language QUALITY is ' +
      'the /language-quality endpoint, and duplicating it here would let a ' +
      'reader compare a number with itself. The tail beyond `maxSeries` ' +
      'languages is pooled into "Other" on the server so a client cannot invent ' +
      'a ninth colour for a dimension nobody can hold nine of; sessions with no ' +
      'resolvable language become "Unknown". `bucketTotals` travels with the ' +
      'shares because a 100%-stacked chart hides its own denominator — every bar ' +
      'is the same height over forty sessions or four thousand.',
  })
  @ApiResponse({
    status: 200,
    description: 'Language mix retrieved successfully',
    type: LanguageMixResponseDto,
  })
  async getLanguageMix(
    @Query() query: LanguageMixQueryDto,
  ): Promise<LanguageMixResponseDto> {
    return this.languageMixAnalyticsService.getLanguageMix(query);
  }

  @Get('skill-growth')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Composite score by Nth completed session (super-admin)',
    description:
      "Does a learner's eighth simulation score better than their first — the " +
      'efficacy question the training product exists to answer. Median with the ' +
      'interquartile range per session ordinal, because an average without a ' +
      'distribution is a half-truth and in scoring the spread is always the ' +
      'interesting half. Two variants come from ONE pass over one denominator: ' +
      '`all` (every learner) and `experienced` (only learners with ' +
      '`experiencedMinSessions`+ evaluated sessions), the control for the ' +
      'survivorship the first cannot rule out — computed separately they would ' +
      'drift. Percentiles are null below `minSampleSize` observations for that ' +
      'ordinal while `n` still travels, so a surface can say "n = 4 · need 20" ' +
      'rather than print a number it cannot stand behind. ALL-TIME by design: an ' +
      "ordinal is a position in a learner's own history, not a date, so a " +
      'windowed version would report the length of the window. Scores are LLM ' +
      'judged and comparable only within one judge/rubric version — see ' +
      '`provenance`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Skill growth curve retrieved successfully',
    type: SkillGrowthResponseDto,
  })
  async getSkillGrowth(
    @Query() query: SkillGrowthQueryDto,
  ): Promise<SkillGrowthResponseDto> {
    return this.skillGrowthAnalyticsService.getSkillGrowth(query);
  }

  @Get('skill-growth/learners')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Learners with their own-baseline skill trend (super-admin)',
    description:
      'The drill-down behind the skill-growth curve: one row per learner with ' +
      'an evaluated session, classified improving/flat/declining against ' +
      'their OWN first sessions (last `window` vs first `window` mean, flat ' +
      'within ±`flatBand`). Learners below `minSessions` are listed as ' +
      '`insufficient` with null means rather than hidden, so the classified ' +
      'share is read against the whole population. Self-vs-self on purpose: ' +
      'no cross-learner ranking is offered, only sort keys. Thresholds travel ' +
      'in the response; scores are LLM judged — see `provenance`.',
  })
  @ApiResponse({
    status: 200,
    description: 'Learner trend page retrieved successfully',
    type: SkillGrowthLearnersResponseDto,
  })
  async getSkillGrowthLearners(
    @Query() query: SkillGrowthLearnersQueryDto,
  ): Promise<SkillGrowthLearnersResponseDto> {
    return this.skillGrowthAnalyticsService.getLearnerTrends(query);
  }

  @Get('skill-growth/learners/:userId')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: "One learner's skill timeline (super-admin)",
    description:
      'Every evaluated roleplay session (composite score plus per-skill ' +
      '`skillCoverage` where the evaluation left one) and every scored ' +
      'quiz/annotation attempt for one learner, oldest first. The two series ' +
      'are returned side by side and never blended — a composite index would ' +
      'hide which signal moved. 404 on an unknown user id; a known learner ' +
      'with no evaluated sessions returns empty series, because "no judged ' +
      'sessions yet" is an answer, not an error.',
  })
  @ApiParam({ name: 'userId', description: 'users.id of the learner' })
  @ApiResponse({
    status: 200,
    description: 'Learner series retrieved successfully',
    type: SkillGrowthLearnerSeriesResponseDto,
  })
  async getSkillGrowthLearnerSeries(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<SkillGrowthLearnerSeriesResponseDto> {
    return this.skillGrowthAnalyticsService.getLearnerSeries(userId);
  }

  @Get('quality-distribution')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Quality percentiles and satisfaction mix per period (super-admin)',
    description:
      'The distribution-aware successor to the two mean-lines on Highlights. ' +
      '(1) `quality`: median with p25/p75 of the LLM-judged composite score per ' +
      'bucket, sparse — a bucket with no evaluated sessions is ABSENT, because ' +
      'an average has no meaningful zero and gap-filling one fabricates a ' +
      'measurement. (2) `satisfaction`: ratings split 1-2 / 3 / 4-5 rather than ' +
      'averaged, since a mean of 3.8 from all-4s and a mean of 3.8 from ' +
      'half-5s-and-half-2s call for opposite responses; the counts are ' +
      'gap-filled but every derived percentage is null over a zero denominator, ' +
      'and `responseRatePct` states what share of completed sessions were rated ' +
      'at all — the silent denominator behind any satisfaction figure. (3) ' +
      '`lowRatingTags`: what sessions rated 3 or below were tagged with, ranked, ' +
      'tail pooled into "Other". Percentiles are suppressed below ' +
      '`minSampleSize` while the counts survive.',
  })
  @ApiResponse({
    status: 200,
    description: 'Quality distribution retrieved successfully',
    type: QualityDistributionResponseDto,
  })
  async getQualityDistribution(
    @Query() query: QualityDistributionQueryDto,
  ): Promise<QualityDistributionResponseDto> {
    return this.qualityDistributionAnalyticsService.getQualityDistribution(
      query,
    );
  }

  @Get('competency-map')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Practice volume against median score per competency (super-admin)',
    description:
      'Which counselling competencies are heavily practised, and which score ' +
      'badly — high volume with a low score is a teaching gap, low volume is a ' +
      "coverage gap. Attributed through the scenario's competency tags; a " +
      'scenario tagged with several competencies counts towards EACH of them, so ' +
      'the per-competency session counts can sum to more than ' +
      '`summary.completedSessions` (declared rather than silently ' +
      'double-counted). Sessions whose scenario carries no competency are ' +
      'reported separately as `unattributed` instead of being dropped. ' +
      '`medianScore` is null below `minSampleSize` evaluated sessions with ' +
      '`belowFloor` set and the row still present — the counts are not an ' +
      'estimate of anything and suppressing the row would hide the tail. ' +
      'ALL-TIME: a monthly competency total says more about the month.',
  })
  @ApiResponse({
    status: 200,
    description: 'Competency map retrieved successfully',
    type: CompetencyMapResponseDto,
  })
  async getCompetencyMap(
    @Query() query: CompetencyMapQueryDto,
  ): Promise<CompetencyMapResponseDto> {
    return this.competencyMapAnalyticsService.getCompetencyMap(query);
  }

  @Get('track-dropoff')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Track item completion by format (super-admin)',
    description:
      'Of the track items learners actually reached, the share they finished, ' +
      'broken down by item FORMAT (roleplay / case / quiz / article / video / ' +
      'journal) and by section. Format rather than position: position in a track ' +
      'is confounded with format, and format is the lever anyone can pull. ' +
      '"Reached" means a progress row that is not LOCKED — an item the learner ' +
      "could get to. Item types come back in the platform's own enum order, " +
      'because an ordered category keeps its order everywhere including a ' +
      'legend, and a list that re-sorts itself between loads cannot be compared ' +
      "with last week's screenshot. Rates over fewer than `minGroupSize` " +
      'learners are suppressed while the row and its counts stay.',
  })
  @ApiResponse({
    status: 200,
    description: 'Track drop-off retrieved successfully',
    type: TrackDropoffResponseDto,
  })
  async getTrackDropoff(
    @Query() query: TrackDropoffQueryDto,
  ): Promise<TrackDropoffResponseDto> {
    return this.trackDropoffAnalyticsService.getTrackDropoff(query);
  }

  @Get('coaching-loop')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Review sharing and turnaround per period (super-admin)',
    description:
      'Whether the human feedback loop is alive: how many completed sessions ' +
      'were shared for review, and how long learners wait for the first comment ' +
      'from someone else. Adoption and responsiveness are returned as separate ' +
      'series so a client can draw two panels rather than two axes — a count and ' +
      'a duration on one pair of axes invite a correlation the data does not ' +
      'support. Turnaround percentiles are null below `minSampleSize` reviews in ' +
      'the bucket: a median over two reviews is a name, not a statistic. ' +
      'Aggregate only, and deliberately never broken down by reviewer — naming a ' +
      'slow trainer is a judgement this surface must not make.',
  })
  @ApiResponse({
    status: 200,
    description: 'Coaching loop metrics retrieved successfully',
    type: CoachingLoopResponseDto,
  })
  async getCoachingLoop(
    @Query() query: CoachingLoopQueryDto,
  ): Promise<CoachingLoopResponseDto> {
    return this.coachingLoopAnalyticsService.getCoachingLoop(query);
  }

  @Get('org-health')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Per-organisation activity, recency and credit use (super-admin)',
    description:
      'One row per customer organisation, ordered by longest silence first — the ' +
      'account-management agenda. All-time totals plus a trailing 12-ISO-week ' +
      'trend on a shared axis (so rows are comparable with each other, not each ' +
      'scaled to itself) and last-28-days against previous-28-days for ' +
      'direction. Ordered by recency rather than volume because a lifetime total ' +
      'makes an org that stopped three months ago look like a top customer, ' +
      'which is the opposite of the churn question. Credit utilisation is summed ' +
      'from the PER-USER `simulation_credits` rows; an org with no limit set ' +
      'returns null with `creditsUnset` rather than 0%, because there is no ' +
      'ceiling to be a share of. Orgs under `minGroupSize` learners keep their ' +
      'counts and have their rates suppressed — a percentage over four ' +
      'identifiable people is a statement about those people.',
  })
  @ApiResponse({
    status: 200,
    description: 'Organisation health retrieved successfully',
    type: OrgHealthResponseDto,
  })
  async getOrgHealth(
    @Query() query: OrgHealthQueryDto,
  ): Promise<OrgHealthResponseDto> {
    return this.orgHealthAnalyticsService.getOrgHealth(query);
  }

  @Get('org-session-distribution')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Orgs bucketed by avg session time and avg session frequency per learner (super-admin)',
    description:
      'How the whole customer base is shaped, not which specific org is ' +
      'struggling (see org-health for that): all-time average minutes-played ' +
      'per learner, and all-time average completed sessions per learner, each ' +
      'bucketed into bands across every non-test org. Meaningful ONLY ' +
      "platform-wide — a single org's average has no band without every " +
      'other org to compare against. Suppressed (empty bands) below ' +
      'minGroupSize orgs.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Org session-time/frequency distribution retrieved successfully',
    type: OrgSessionDistributionResponseDto,
  })
  async getOrgSessionDistribution(
    @Query() query: OrgSessionDistributionQueryDto,
  ): Promise<OrgSessionDistributionResponseDto> {
    return this.orgSessionDistributionAnalyticsService.getDistribution(query);
  }

  @Get('learner-kpis')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'LEARNER-role-scoped headline KPIs (super-admin)',
    description:
      "The overview endpoint's totalUsers/activeUsers/simulationsCompleted " +
      'count every account regardless of role, so an admin or counsellor ' +
      'moves the same numbers a learner does. This is the LEARNER-only cut: ' +
      'all-time total/active learners, all-time completed sessions ' +
      'attributed to learners, and an all-time monthly learner-signup trend.',
  })
  @ApiResponse({
    status: 200,
    description: 'Learner-scoped KPIs retrieved successfully',
    type: LearnerKpisResponseDto,
  })
  async getLearnerKpis(
    @Query() query: LearnerKpisQueryDto,
  ): Promise<LearnerKpisResponseDto> {
    return this.learnerKpisAnalyticsService.getLearnerKpis(query);
  }

  @Get('scenario-usage')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Most/least-used scenarios, platform-wide (super-admin)',
    description:
      'Top and bottom scenarios by all-time completed-session count, across ' +
      'every non-test tenant — the platform-wide counterpart of the ' +
      'tenant-scoped "most used simulations" list on the Organization Metrics ' +
      'dashboard. "Least-used" is among scenarios with >=1 completed ' +
      'session; a never-completed scenario has no row to rank.',
  })
  @ApiResponse({
    status: 200,
    description: 'Scenario usage retrieved successfully',
    type: ScenarioUsageResponseDto,
  })
  async getScenarioUsage(
    @Query() query: ScenarioUsageQueryDto,
  ): Promise<ScenarioUsageResponseDto> {
    return this.scenarioUsageAnalyticsService.getScenarioUsage(query);
  }

  @Get('scribe-adoption')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Orgs and counsellors using Scribe per period (super-admin)',
    description:
      'Whether the live-support stream is spreading beyond pilots: distinct ' +
      'organisations and distinct counsellors with at least one scribe session ' +
      'per bucket, with session volume as context. BREADTH, not operations — one ' +
      'enthusiastic org can carry a session count on its own, and failure rates, ' +
      'pipeline funnels and STT provider reliability already live on ' +
      '/scribe/overview and /scribe/summary-failures. Archived sessions are ' +
      'excluded. Counts, so the axis is gap-filled with real zeros.',
  })
  @ApiResponse({
    status: 200,
    description: 'Scribe adoption retrieved successfully',
    type: ScribeAdoptionResponseDto,
  })
  async getScribeAdoption(
    @Query() query: ScribeAdoptionQueryDto,
  ): Promise<ScribeAdoptionResponseDto> {
    return this.scribeAdoptionAnalyticsService.getScribeAdoption(query);
  }

  @Get('voice-latency')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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

  @Get('voice-latency/sessions')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Session-wise voice latency for one simulation (super-admin)',
    description:
      'One row per session (worst-first by avg response latency), averaging ' +
      "that session's turns across every pipeline stage (EOU, STT finalize, " +
      'LLM TTFT, process events, knowledge retrieval, TTS TTFB, behaviors). ' +
      'Optionally narrowed further by `language`. See the sibling ' +
      '`/voice-latency/sessions/summary` endpoint for the whole-filtered-set ' +
      "average, independent of this endpoint's pagination.",
  })
  @ApiResponse({
    status: 200,
    description: 'Session-wise voice latency retrieved successfully',
    type: ListVoiceLatencySessionsResponseDto,
  })
  async getVoiceLatencySessions(
    @Query() query: VoiceLatencySessionsQueryDto,
  ): Promise<ListVoiceLatencySessionsResponseDto> {
    return this.platformAnalyticsService.getVoiceLatencySessions(query);
  }

  @Get('voice-latency/sessions/summary')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary:
      'Session-wise voice latency summary for one simulation (super-admin)',
    description:
      'Overall average across every session matching the scenario(+language) ' +
      'filter, over the full window (not just the current page of ' +
      '`/voice-latency/sessions`).',
  })
  @ApiResponse({
    status: 200,
    description: 'Voice latency summary retrieved successfully',
    type: VoiceLatencySessionsSummaryResponseDto,
  })
  async getVoiceLatencySessionsSummary(
    @Query() query: VoiceLatencySessionsSummaryQueryDto,
  ): Promise<VoiceLatencySessionsSummaryResponseDto> {
    return this.platformAnalyticsService.getVoiceLatencySessionsSummary(query);
  }

  @Get('voice-latency/by-scenario')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Voice latency ranked by simulation, worst-first (super-admin)',
    description:
      'One row per simulation with a matching turn in the window, sorted by ' +
      'avg response latency descending, with the same per-stage breakdown ' +
      '(EOU, STT finalize, LLM TTFT, process events, knowledge retrieval, ' +
      'TTS TTFB, behaviors) as `/voice-latency/sessions` — "which ' +
      'simulations are slow" as its own question, distinct from that ' +
      'endpoint\'s "this simulation\'s worst sessions, once known".',
  })
  @ApiResponse({
    status: 200,
    description: 'Voice latency by simulation retrieved successfully',
    type: VoiceLatencyByScenarioResponseDto,
  })
  async getVoiceLatencyByScenario(
    @Query() query: VoiceLatencyByScenarioQueryDto,
  ): Promise<VoiceLatencyByScenarioResponseDto> {
    return this.platformAnalyticsService.getVoiceLatencyByScenario(query);
  }

  @Get('agent-join-reliability')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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

  @Get('weak-performing-metrics')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Weak performing metrics dashboard (super-admin)',
    description:
      'The five simulator-quality metrics under active repair — actor ' +
      'responsiveness, conversational progression & resolution, language ' +
      'realism, feedback groundedness and actor clienthood — as trends over ' +
      'one shared filter tuple.\n\n' +
      'Judge labels and deterministic measures are combined, but never mixed: ' +
      'the judges contribute only booleans, enum labels and counts, and every ' +
      'rate, weight and correlation is computed in SQL or in the service. ' +
      'Each series carries its own state (measured / partial / none) and the ' +
      'caveat needed to read it honestly — several are deliberately partial ' +
      'and a bare number would be over-read.\n\n' +
      'Always segment: three findings in this data turned out to be ' +
      'composition artefacts rather than regressions, so language, model and ' +
      'scenario filters are part of the metric, not decoration.',
  })
  @ApiResponse({ status: 200, type: WeakMetricsResponseDto })
  async getWeakPerformingMetrics(
    @Query() query: WeakMetricsQueryDto,
  ): Promise<WeakMetricsResponseDto> {
    return this.weakMetricsAnalyticsService.getWeakMetrics(query);
  }

  @Post('feedback-groundedness/backfill')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Judge whether post-session feedback is true (super-admin)',
    description:
      'Runs the feedback-groundedness judge over stored feedback: each claim ' +
      'is checked against the session transcript and labelled supported, ' +
      'unsupported, contradicted or misattributed.\n\n' +
      'This is the only metric that measures whether the number a learner is ' +
      'graded by is CORRECT — delivery and score discrimination were already ' +
      'measurable, truth was not.\n\n' +
      'The longest and most expensive of the three backfills (a Gemini call ' +
      'per session over a full transcript, ~2,673 sessions for a year). ' +
      'Confirm judge token-usage emission is switched on first, or the spend ' +
      'is invisible until it is billed. Pass judgePromptVersion to make the ' +
      'run resumable — re-issuing skips whatever already landed.',
  })
  @ApiResponse({ status: 202, type: GroundednessBackfillJobDto })
  async startGroundednessBackfill(
    @Body() body: StartGroundednessBackfillDto,
  ): Promise<GroundednessBackfillJobDto> {
    const unjudgedForVersion = body.judgePromptVersion
      ? {
          judgeModel: body.judgeModel ?? 'gemini-2.5-pro',
          judgePromptVersion: body.judgePromptVersion,
        }
      : null;
    return this.feedbackGroundednessJudgeService.startBackfill(
      body.sinceDays ?? 365,
      unjudgedForVersion,
      body.concurrency,
    );
  }

  @Get('feedback-groundedness/backfill/:jobId')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Groundedness backfill job status (super-admin)' })
  @ApiResponse({ status: 200, type: GroundednessBackfillJobDto })
  async groundednessBackfillStatus(
    @Param('jobId') jobId: string,
  ): Promise<GroundednessBackfillJobDto> {
    const job = await this.feedbackGroundednessJudgeService.getJob(jobId);
    if (!job) {
      throw new NotFoundException(`Backfill job ${jobId} not found`);
    }
    return job;
  }

  @Post('conversation-drift/backfill')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
    // A rubric version turns this into a RE-judge: only sessions without rows
    // under that version are picked up, so it skips work already done and is
    // safe to re-issue after a failure. Without one it keeps the original
    // meaning — judge whatever has never been judged at all.
    const unjudgedForVersion = body.judgePromptVersion
      ? {
          judgeModel: body.judgeModel ?? 'gemini-2.5-pro',
          judgePromptVersion: body.judgePromptVersion,
        }
      : null;
    // Lean mode needs BOTH versions: the one to copy forward from, and the one
    // to write. Without a target version there is nothing to pin the new rows
    // to, so it is rejected rather than guessed at.
    const leanFromVersion =
      body.lean && unjudgedForVersion
        ? {
            judgeModel: body.judgeModel ?? 'gemini-2.5-pro',
            judgePromptVersion: body.leanFromPromptVersion ?? 'v1',
          }
        : null;
    if (body.lean && !unjudgedForVersion) {
      throw new BadRequestException(
        'lean backfill requires judgePromptVersion: it names the version the ' +
          'topped-up rows are written under, which is what the dashboard pins.',
      );
    }

    return this.platformAnalyticsService.startDriftBackfill(
      body.sinceDays ?? 90,
      Boolean(unjudgedForVersion),
      unjudgedForVersion,
      body.concurrency,
      leanFromVersion,
    );
  }

  @Get('conversation-drift/backfill/:jobId')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({ summary: 'Drift backfill job status (super-admin)' })
  @ApiResponse({ status: 200, type: DriftBackfillJobDto })
  async driftBackfillStatus(
    @Param('jobId') jobId: string,
  ): Promise<DriftBackfillJobDto> {
    return this.platformAnalyticsService.getDriftBackfillStatus(jobId);
  }

  @Get('language-quality')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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

  @Get('glossary-effect')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
  @ApiOperation({
    summary: 'Did the language glossary change anything? (super-admin)',
    description:
      'Adherence (deterministic avoid-term hits per 100 agent messages) and ' +
      'naturalness (severity-weighted style errors per 100 judged turns) on ' +
      "the same sessions, before vs after EACH language's own glossary " +
      'go-live, segmented by agent model and pinned to one judge version. ' +
      'Compare only cells sharing a language and an agentModel: pooling ' +
      'across models reads a traffic-mix shift as a result.',
  })
  @ApiResponse({ status: 200, type: GlossaryEffectResponseDto })
  async getGlossaryEffect(
    @Query() query: GlossaryEffectQueryDto,
  ): Promise<GlossaryEffectResponseDto> {
    return this.glossaryEffectAnalyticsService.getGlossaryEffect(query);
  }

  @Get('language-quality/reference')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
    // Three modes, in increasing cost:
    //  - default              judge sessions never judged by any rubric
    //  - judgePromptVersion   judge sessions not yet judged by THAT rubric
    //                         (the re-judge path; resumable, skips done work)
    //  - rejudge=true         re-run everything, including already-judged
    const unjudgedForVersion = body.judgePromptVersion
      ? {
          judgeModel: body.judgeModel ?? 'gemini-2.5-pro',
          judgePromptVersion: body.judgePromptVersion,
        }
      : null;
    return this.languageJudgeService.startBackfill(
      body.sinceDays ?? 90,
      unjudgedForVersion ? true : !body.rejudge,
      unjudgedForVersion,
      body.concurrency,
    );
  }

  @Get('language-quality/backfill/:jobId')
  @RequireFeatureToggle(FeatureToggleKey.ANALYTICS)
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
        failed: 0,
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
