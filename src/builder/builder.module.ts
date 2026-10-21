import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { LlmModule } from 'src/llm/llm.module';
import { ReleaseModule } from 'src/release/release.module';
import { BuilderSlackController } from './controller/builder-slack.controller';
import { BuilderSlackService } from './service/builder-slack.service';
import { AuthModule } from 'src/auth/auth.module';
import { GithubModule } from 'src/github/github.module';
import { BugHunterModule } from 'src/bug-hunter/bug-hunter.module';
import { AnalyticsAgentModule } from 'src/analytics-agent/analytics-agent.module';
import { LogsModule } from 'src/logs/logs.module';
import { UxSignalsModule } from 'src/ux-signals/ux-signals.module';
import { NotificationModule } from 'src/notification/notification.module';
import { BuilderSession } from './entity/builder-session.entity';
import { BuilderMessage } from './entity/builder-message.entity';
import { BuilderPrdDoc } from './entity/builder-prd-doc.entity';
import { BuilderPrdVersion } from './entity/builder-prd-version.entity';
import { BuilderRepoMap } from './entity/builder-repo-map.entity';
import { BuilderLesson } from './entity/builder-lesson.entity';
import { BuilderExemplar } from './entity/builder-exemplar.entity';
import { BuilderMilestone } from './entity/builder-milestone.entity';
import { BuilderBuildRun } from './entity/builder-build-run.entity';
import { BuilderBuildEvent } from './entity/builder-build-event.entity';
import { BuilderPullRequest } from './entity/builder-pull-request.entity';
import { BuilderPrFeedback } from './entity/builder-pr-feedback.entity';
import { BuilderSettings } from './entity/builder-settings.entity';
import { BuilderNotification } from './entity/builder-notification.entity';
import { BuilderRepoCatalog } from './entity/builder-repo-catalog.entity';
import { BuilderEvidence } from './entity/builder-evidence.entity';
import { BuilderController } from './controller/builder.controller';
import { BuilderPipelineController } from './controller/builder-pipeline.controller';
import { BuilderGateway } from './gateway/builder.gateway';
import { BuilderSessionService } from './service/builder-session.service';
import { BuilderPrdService } from './service/builder-prd.service';
import { BuilderKnowledgeService } from './service/builder-knowledge.service';
import { BuilderGithubReadService } from './service/builder-github-read.service';
import { BuilderStacksService } from './service/builder-stacks.service';
import { BuilderEvidenceService } from './service/builder-evidence.service';
import { BuilderInterviewToolsService } from './service/builder-interview-tools.service';
import { BuilderInterviewOrchestratorService } from './service/builder-interview-orchestrator.service';
import { BuilderBuildService } from './service/builder-build.service';
import { BuilderEventService } from './service/builder-event.service';
import { BuilderPullRequestService } from './service/builder-pull-request.service';
import { BuilderSettingsService } from './service/builder-settings.service';
import { BuilderLessonCuratorService } from './service/builder-lesson-curator.service';
import { BuilderExemplarService } from './service/builder-exemplar.service';
import { BuilderOutcomeService } from './service/builder-outcome.service';
import { BuilderMetricsService } from './service/builder-metrics.service';
import { BuilderEpicService } from './service/builder-epic.service';
import { BuilderResearchService } from './service/builder-research.service';
import { BuilderCatalogService } from './service/builder-catalog.service';
import { BuilderEvidenceLogService } from './service/builder-evidence-log.service';
import { BuilderPrdReviewService } from './service/builder-prd-review.service';
import { BuilderEvalFixture } from './entity/builder-eval-fixture.entity';
import { BuilderEvalSuite } from './entity/builder-eval-suite.entity';
import { BuilderEvalRun } from './entity/builder-eval-run.entity';
import { BuilderEvalSandboxFactory } from './eval/sandbox/builder-eval-sandbox.factory';
import { BuilderEvalRunnerService } from './eval/service/builder-eval-runner.service';
import { BuilderEvalFixtureService } from './eval/service/builder-eval-fixture.service';
import { BuilderEvalService } from './eval/service/builder-eval.service';
import { BuilderEvalController } from './eval/controller/builder-eval.controller';
import { BuilderCorrection } from './entity/builder-correction.entity';
import { BuilderCorrectionService } from './service/builder-correction.service';
import { BuilderCorrectionsController } from './controller/builder-corrections.controller';
import { BuilderReadinessService } from './service/builder-readiness.service';
import { BuilderProductMapService } from './service/builder-product-map.service';
import { BuilderPlatformContextService } from './service/builder-platform-context.service';
import { BuilderNotificationService } from './service/builder-notification.service';
import { BuilderSchedulerRegistrationService } from './service/builder-scheduler-registration.service';
import { BuilderSessionRepository } from './repository/builder-session.repository';
import { BuilderMessageRepository } from './repository/builder-message.repository';
import {
  BuilderPrdDocRepository,
  BuilderPrdVersionRepository,
} from './repository/builder-prd.repository';
import {
  BuilderLessonRepository,
  BuilderEvidenceRepository,
  BuilderExemplarRepository,
  BuilderRepoCatalogRepository,
  BuilderRepoMapRepository,
} from './repository/builder-knowledge.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderNotificationRepository,
  BuilderPullRequestRepository,
  BuilderPrFeedbackRepository,
} from './repository/builder-build.repository';

/**
 * Builder: the admin agent that interviews an admin into a PRD and then
 * builds it.
 *
 * Two halves that share one set of tables. The **interview** runs in-process
 * (Anthropic SDK, SSE to the browser). The **build** runs somewhere else
 * entirely — ally-be cannot check out a repo, run a test suite or open a pull
 * request from inside its container. A build is a GitHub issue in its repo,
 * worked into a pull request by that repo's opencode workflow; the technical
 * design is drafted on Builder's own runner (builder-session.yml). Everything
 * asymmetric about this module (a machine-auth controller, a reconcile tick,
 * prompt-over-HTTP) follows from that split.
 *
 * `GithubModule` supplies the dispatch/cancel client. It used to reach that
 * through `BugHunterModule`, which said "Builder depends on Bug Hunter" when
 * what it depended on was an HTTP client; the client now has its own module
 * and the two agents share a dependency rather than one another.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BuilderSession,
      BuilderMessage,
      BuilderPrdDoc,
      BuilderPrdVersion,
      BuilderRepoMap,
      BuilderLesson,
      BuilderExemplar,
      BuilderMilestone,
      BuilderBuildRun,
      BuilderBuildEvent,
      BuilderPullRequest,
      BuilderPrFeedback,
      BuilderSettings,
      BuilderNotification,
      BuilderRepoCatalog,
      BuilderEvidence,
      BuilderEvalFixture,
      BuilderEvalSuite,
      BuilderEvalRun,
      BuilderCorrection,
    ]),
    PromptModule,
    LlmUsageModule,
    // The interview's provider-agnostic LLM access: AgentLlmProviderFactory
    // for the streamed tool loop, LlmCompletionService for the one-shot
    // transcript digest.
    LlmAgentModule,
    // For LlmModelsRepository: the preflight in BuilderBuildService checks a
    // run's models against the catalog before dispatching to the engine.
    LlmModule,
    ReleaseModule,
    AuthModule,
    GithubModule,
    // For BugFindingService only: the evidence service reads open findings.
    // A domain dependency, unlike the GitHub client that used to be smuggled
    // through this same import.
    BugHunterModule,
    // Lane A evidence sources: production numbers, production errors. Read
    // through each owner's own service rather than its HTTP surface, which is
    // gated for a logged-in human.
    AnalyticsAgentModule,
    LogsModule,
    // UxSignalReadService: the fourth evidence source, and the only one that
    // speaks for users rather than for the system.
    UxSignalsModule,
    // SlackService: the inbox is a pull surface, so a paused build needs a push.
    NotificationModule,
  ],
  controllers: [
    BuilderSlackController,
    BuilderController,
    BuilderPipelineController,
    BuilderEvalController,
    BuilderCorrectionsController,
  ],
  providers: [
    BuilderSlackService,
    BuilderGateway,
    BuilderSessionService,
    BuilderPrdService,
    BuilderKnowledgeService,
    BuilderGithubReadService,
    BuilderStacksService,
    BuilderEvidenceService,
    BuilderInterviewToolsService,
    BuilderInterviewOrchestratorService,
    BuilderBuildService,
    BuilderEventService,
    BuilderPullRequestService,
    BuilderSettingsService,
    BuilderLessonCuratorService,
    BuilderExemplarService,
    BuilderOutcomeService,
    BuilderMetricsService,
    BuilderEpicService,
    BuilderResearchService,
    BuilderCatalogService,
    BuilderEvidenceLogService,
    BuilderPrdReviewService,
    BuilderReadinessService,
    BuilderEvalSandboxFactory,
    BuilderEvalRunnerService,
    BuilderEvalFixtureService,
    BuilderEvalService,
    BuilderCorrectionService,
    BuilderProductMapService,
    BuilderPlatformContextService,
    BuilderNotificationService,
    BuilderSchedulerRegistrationService,
    BuilderSessionRepository,
    BuilderMessageRepository,
    BuilderPrdDocRepository,
    BuilderPrdVersionRepository,
    BuilderRepoMapRepository,
    BuilderRepoCatalogRepository,
    BuilderEvidenceRepository,
    BuilderLessonRepository,
    BuilderExemplarRepository,
    BuilderBuildRunRepository,
    BuilderBuildEventRepository,
    BuilderPullRequestRepository,
    BuilderPrFeedbackRepository,
    BuilderNotificationRepository,
  ],
  exports: [
    BuilderSessionService,
    BuilderKnowledgeService,
    // The read-only research belt, reused by the roadmap's opportunity copilot so it reads the
    // same repos, the same Stacks library and the same production evidence through the same
    // fail-soft wrappers — rather than a second GitHub client and a second deadline policy.
    BuilderGithubReadService,
    BuilderStacksService,
    BuilderEvidenceService,
    // One product map for both agents: the copilot renders it whole, the interview reads the
    // reusable-systems and docs sections. See BuilderProductMapService.
    BuilderProductMapService,
    BuilderCatalogService,
  ],
})
export class BuilderModule {}
