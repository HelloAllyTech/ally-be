import { Module } from '@nestjs/common';
import { AnalyticsController } from './controller/analytics.controller';
import { TenantAnalyticsController } from './controller/tenant-analytics.controller';
import { AnalyticsService } from './service/analytics.service';
import { HighlightsAnalyticsService } from './service/highlights-analytics.service';
import { HighlightsAnalyticsRepository } from './repository/highlights-analytics.repository';
import { CohortAnalyticsService } from './service/cohort-analytics.service';
import { CohortAnalyticsRepository } from './repository/cohort-analytics.repository';
import { UsageLevelAnalyticsService } from './service/usage-level-analytics.service';
import { UsageLevelAnalyticsRepository } from './repository/usage-level-analytics.repository';
import { CertificationAnalyticsService } from './service/certification-analytics.service';
import { CertificationAnalyticsRepository } from './repository/certification-analytics.repository';
import { RoleplayVolumeAnalyticsService } from './service/roleplay-volume-analytics.service';
import { RoleplayVolumeAnalyticsRepository } from './repository/roleplay-volume-analytics.repository';
// Analytics → Product management tab: reads the internal product roadmap rather
// than learner activity, so it is neither tenant-scoped nor windowed.
import { RoadmapDeliveryAnalyticsService } from './service/roadmap-delivery-analytics.service';
import { RoadmapDeliveryAnalyticsRepository } from './repository/roadmap-delivery-analytics.repository';
// Testing-tab endpoints: candidates for the leadership Highlights tab, kept on a
// separate admin tab until they have proved they change a decision.
import { ActivationAnalyticsService } from './service/activation-analytics.service';
import { ActivationAnalyticsRepository } from './repository/activation-analytics.repository';
import { CompletionRateAnalyticsService } from './service/completion-rate-analytics.service';
import { CompletionRateAnalyticsRepository } from './repository/completion-rate-analytics.repository';
import { LanguageMixAnalyticsService } from './service/language-mix-analytics.service';
import { LanguageMixAnalyticsRepository } from './repository/language-mix-analytics.repository';
import { SkillGrowthAnalyticsService } from './service/skill-growth-analytics.service';
import { SkillGrowthAnalyticsRepository } from './repository/skill-growth-analytics.repository';
import { QualityDistributionAnalyticsService } from './service/quality-distribution-analytics.service';
import { QualityDistributionAnalyticsRepository } from './repository/quality-distribution-analytics.repository';
import { CompetencyMapAnalyticsService } from './service/competency-map-analytics.service';
import { CompetencyMapAnalyticsRepository } from './repository/competency-map-analytics.repository';
import { TrackDropoffAnalyticsService } from './service/track-dropoff-analytics.service';
import { TrackDropoffAnalyticsRepository } from './repository/track-dropoff-analytics.repository';
import { CoachingLoopAnalyticsService } from './service/coaching-loop-analytics.service';
import { CoachingLoopAnalyticsRepository } from './repository/coaching-loop-analytics.repository';
import { OrgHealthAnalyticsService } from './service/org-health-analytics.service';
import { OrgHealthAnalyticsRepository } from './repository/org-health-analytics.repository';
import { OrgSessionDistributionAnalyticsService } from './service/org-session-distribution-analytics.service';
import { OrgSessionDistributionAnalyticsRepository } from './repository/org-session-distribution-analytics.repository';
import { LearnerKpisAnalyticsService } from './service/learner-kpis-analytics.service';
import { LearnerKpisAnalyticsRepository } from './repository/learner-kpis-analytics.repository';
import { ScenarioUsageAnalyticsService } from './service/scenario-usage-analytics.service';
import { ScenarioUsageAnalyticsRepository } from './repository/scenario-usage-analytics.repository';
import { ScribeAdoptionAnalyticsService } from './service/scribe-adoption-analytics.service';
import { ScribeAdoptionAnalyticsRepository } from './repository/scribe-adoption-analytics.repository';
import { UsageLadderAnalyticsService } from './service/usage-ladder-analytics.service';
import { UsageLadderAnalyticsRepository } from './repository/usage-ladder-analytics.repository';
import { PracticeDepthAnalyticsService } from './service/practice-depth-analytics.service';
import { PracticeDepthAnalyticsRepository } from './repository/practice-depth-analytics.repository';
import { OrgEngagementAnalyticsService } from './service/org-engagement-analytics.service';
import { OrgEngagementAnalyticsRepository } from './repository/org-engagement-analytics.repository';
import { RoleplayCostAnalyticsService } from './service/roleplay-cost-analytics.service';
import { RoleplayCostAnalyticsRepository } from './repository/roleplay-cost-analytics.repository';
import { QualitySentimentAnalyticsService } from './service/quality-sentiment-analytics.service';
import { QualitySentimentAnalyticsRepository } from './repository/quality-sentiment-analytics.repository';
// Roleplay Quality Index: the composite behind the "Roleplay quality" card,
// replacing the mean-composite trend and the quality-distribution series.
import { QualityIndexAnalyticsService } from './service/quality-index-analytics.service';
import { QualityIndexAnalyticsRepository } from './repository/quality-index-analytics.repository';
import { QualityThresholdRepository } from './repository/quality-threshold.repository';
import { QualityThresholdCalibrationService } from './service/quality-threshold-calibration.service';
import { AnalyticsQualityThreshold } from './entity/analytics-quality-threshold.entity';
import { ChartPreferenceService } from './service/chart-preference.service';
import { AnalyticsChartPreference } from './entity/analytics-chart-preference.entity';
import { PlatformAnalyticsService } from './service/platform-analytics.service';
import { ScribeAnalyticsService } from './service/scribe-analytics.service';
import { DriftJudgeService } from './service/drift-judge.service';
import { DriftBackfillSchedulerRegistrationService } from './service/drift-backfill-scheduler-registration.service';
import { JudgeBacklogDrainService } from './service/judge-backlog-drain.service';
import { FillerJudgeService } from './service/filler-judge.service';
import { LanguageJudgeService } from './service/language-judge.service';
import { LanguageBackfillSchedulerRegistrationService } from './service/language-backfill-scheduler-registration.service';
import { PlatformAnalyticsRepository } from './repository/platform-analytics.repository';
import { TenantAnalyticsRepository } from './repository/tenant-analytics.repository';
import { TenantAnalyticsService } from './service/tenant-analytics.service';
import { ScribeAnalyticsRepository } from './repository/scribe-analytics.repository';
import { LlmUsageRepository } from './repository/llm-usage.repository';
import { DriftAnalyticsRepository } from './repository/drift-analytics.repository';
import { DriftJudgeRepository } from './repository/drift-judge.repository';
import { FillerAnalyticsService } from './service/filler-analytics.service';
import { FillerAnalyticsRepository } from './repository/filler-analytics.repository';
import { FillerJudgeRepository } from './repository/filler-judge.repository';
import { LanguageJudgeRepository } from './repository/language-judge.repository';
import { LanguageAnalyticsRepository } from './repository/language-analytics.repository';
import { GlossaryEffectAnalyticsRepository } from './repository/glossary-effect-analytics.repository';
import { GlossaryEffectAnalyticsService } from './service/glossary-effect-analytics.service';
import { LanguageAnalyticsService } from './service/language-analytics.service';
// Analytics -> Weak performing metrics tab: the five simulator-quality metrics
// under active repair, read from the judge tables plus deterministic measures
// over transcripts and turn metrics.
import { WeakMetricsAnalyticsService } from './service/weak-metrics-analytics.service';
import { WeakMetricsAnalyticsRepository } from './repository/weak-metrics-analytics.repository';
// Feedback-groundedness judge: the only metric that checks whether the number
// a learner is graded by is actually true of their session.
import { FeedbackGroundednessJudgeService } from './service/feedback-groundedness-judge.service';
import { FeedbackGroundednessRepository } from './repository/feedback-groundedness.repository';
import { MetabaseService } from './service/metabase.service';
import { AppConfigModule } from '../config/config.module';
import { ProviderFactory } from '../factory/provider.factory';
import { UserModule } from '../user/user.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dashboard } from './entity/dashboards.entity';
import { DashboardRepository } from './repository/dashboard.repository';
import { ChatModule } from '../chat/chat.module';
import { DashboardTenant } from './entity/dashboard-tenant.entity';
import { DashboardGroup } from './entity/dashboard-group.entity';
import { LanguageModule } from 'src/language/language.module';
import { TenantModule } from 'src/tenant/tenant.module';

@Module({
  imports: [
    AppConfigModule,
    UserModule,
    TypeOrmModule.forFeature([
      Dashboard,
      DashboardTenant,
      DashboardGroup,
      AnalyticsChartPreference,
      AnalyticsQualityThreshold,
    ]),
    ChatModule,
    TenantModule,
    // Variety profiles sharpen the language judge's target_variety per
    // tenant population (RSI loop, judge-side wiring).
    LanguageModule,
  ],
  controllers: [AnalyticsController, TenantAnalyticsController],
  providers: [
    AnalyticsService,
    WeakMetricsAnalyticsService,
    WeakMetricsAnalyticsRepository,
    FeedbackGroundednessJudgeService,
    FeedbackGroundednessRepository,
    HighlightsAnalyticsService,
    HighlightsAnalyticsRepository,
    CohortAnalyticsService,
    CohortAnalyticsRepository,
    UsageLevelAnalyticsService,
    UsageLevelAnalyticsRepository,
    CertificationAnalyticsService,
    CertificationAnalyticsRepository,
    RoleplayVolumeAnalyticsService,
    RoleplayVolumeAnalyticsRepository,
    RoadmapDeliveryAnalyticsService,
    RoadmapDeliveryAnalyticsRepository,
    ActivationAnalyticsService,
    ActivationAnalyticsRepository,
    CompletionRateAnalyticsService,
    CompletionRateAnalyticsRepository,
    LanguageMixAnalyticsService,
    LanguageMixAnalyticsRepository,
    SkillGrowthAnalyticsService,
    SkillGrowthAnalyticsRepository,
    QualityDistributionAnalyticsService,
    QualityDistributionAnalyticsRepository,
    CompetencyMapAnalyticsService,
    CompetencyMapAnalyticsRepository,
    TrackDropoffAnalyticsService,
    TrackDropoffAnalyticsRepository,
    CoachingLoopAnalyticsService,
    CoachingLoopAnalyticsRepository,
    OrgHealthAnalyticsService,
    OrgHealthAnalyticsRepository,
    OrgSessionDistributionAnalyticsService,
    OrgSessionDistributionAnalyticsRepository,
    LearnerKpisAnalyticsService,
    LearnerKpisAnalyticsRepository,
    ScenarioUsageAnalyticsService,
    ScenarioUsageAnalyticsRepository,
    ScribeAdoptionAnalyticsService,
    ScribeAdoptionAnalyticsRepository,
    UsageLadderAnalyticsService,
    UsageLadderAnalyticsRepository,
    PracticeDepthAnalyticsService,
    PracticeDepthAnalyticsRepository,
    OrgEngagementAnalyticsService,
    OrgEngagementAnalyticsRepository,
    RoleplayCostAnalyticsService,
    RoleplayCostAnalyticsRepository,
    QualitySentimentAnalyticsService,
    QualitySentimentAnalyticsRepository,
    QualityIndexAnalyticsService,
    QualityIndexAnalyticsRepository,
    QualityThresholdRepository,
    QualityThresholdCalibrationService,
    ChartPreferenceService,
    PlatformAnalyticsService,
    ScribeAnalyticsService,
    DriftJudgeService,
    DriftJudgeRepository,
    DriftBackfillSchedulerRegistrationService,
    JudgeBacklogDrainService,
    LanguageJudgeService,
    LanguageJudgeRepository,
    FillerJudgeService,
    FillerJudgeRepository,
    FillerAnalyticsRepository,
    FillerAnalyticsService,
    LanguageBackfillSchedulerRegistrationService,
    LanguageAnalyticsService,
    LanguageAnalyticsRepository,
    GlossaryEffectAnalyticsService,
    GlossaryEffectAnalyticsRepository,
    PlatformAnalyticsRepository,
    TenantAnalyticsService,
    TenantAnalyticsRepository,
    ScribeAnalyticsRepository,
    LlmUsageRepository,
    DriftAnalyticsRepository,
    MetabaseService,
    ProviderFactory.getAnalyticsFactory(),
    DashboardRepository,
  ],
  /**
   * The per-chart aggregate services, exported for AnalyticsSuggestionsModule.
   *
   * Only the `getX(query)` read services are exported — never the repositories,
   * the judges, or the backfill schedulers. A consumer that wants a figure gets
   * it through the same reviewed service the Analytics tab calls, so the
   * suggestion engine cannot end up reading the platform differently from the
   * dashboard a reader would check it against.
   *
   * Note that nine of these accept a window and six do not: OrgHealth,
   * UsageLevel, RoleplayVolume, SkillGrowth, CompetencyMap and TrackDropoff are
   * all-time by construction (see their query DTOs). Consumers must label those
   * sections as covering platform history rather than the requested period.
   */
  exports: [
    PlatformAnalyticsService,
    HighlightsAnalyticsService,
    ActivationAnalyticsService,
    CompletionRateAnalyticsService,
    LanguageMixAnalyticsService,
    QualityDistributionAnalyticsService,
    CoachingLoopAnalyticsService,
    ScribeAdoptionAnalyticsService,
    ScribeAnalyticsService,
    OrgHealthAnalyticsService,
    UsageLevelAnalyticsService,
    RoleplayVolumeAnalyticsService,
    SkillGrowthAnalyticsService,
    CompetencyMapAnalyticsService,
    TrackDropoffAnalyticsService,
  ],
})
export class AnalyticsModule {}
