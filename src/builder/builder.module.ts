import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
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
import { BuilderQuestion } from './entity/builder-question.entity';
import { BuilderPullRequest } from './entity/builder-pull-request.entity';
import { BuilderPrFeedback } from './entity/builder-pr-feedback.entity';
import { BuilderReport } from './entity/builder-report.entity';
import { BuilderSettings } from './entity/builder-settings.entity';
import { BuilderNotification } from './entity/builder-notification.entity';
import { BuilderSteer } from './entity/builder-steer.entity';
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
import { BuilderQuestionService } from './service/builder-question.service';
import { BuilderPullRequestService } from './service/builder-pull-request.service';
import { BuilderReportService } from './service/builder-report.service';
import { BuilderSettingsService } from './service/builder-settings.service';
import { BuilderLessonCuratorService } from './service/builder-lesson-curator.service';
import { BuilderExemplarService } from './service/builder-exemplar.service';
import { BuilderOutcomeService } from './service/builder-outcome.service';
import { BuilderMetricsService } from './service/builder-metrics.service';
import { BuilderEpicService } from './service/builder-epic.service';
import { BuilderResearchService } from './service/builder-research.service';
import { BuilderNotificationService } from './service/builder-notification.service';
import { BuilderSteerService } from './service/builder-steer.service';
import { BuilderSchedulerRegistrationService } from './service/builder-scheduler-registration.service';
import { BuilderSessionRepository } from './repository/builder-session.repository';
import { BuilderMessageRepository } from './repository/builder-message.repository';
import {
  BuilderPrdDocRepository,
  BuilderPrdVersionRepository,
} from './repository/builder-prd.repository';
import {
  BuilderLessonRepository,
  BuilderExemplarRepository,
  BuilderRepoMapRepository,
} from './repository/builder-knowledge.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderNotificationRepository,
  BuilderPullRequestRepository,
  BuilderPrFeedbackRepository,
  BuilderQuestionRepository,
  BuilderReportRepository,
  BuilderSteerRepository,
} from './repository/builder-build.repository';

/**
 * Builder: the admin agent that interviews an admin into a PRD and then
 * builds it.
 *
 * Two halves that share one set of tables. The **interview** runs in-process
 * (Anthropic SDK, SSE to the browser). The **build** runs somewhere else
 * entirely — ally-be cannot check out a repo, run a test suite or open a pull
 * request from inside its container, so it dispatches a GitHub Actions run and
 * owns the protocol that run follows. Everything asymmetric about this module
 * (a machine-auth controller, a reconcile tick, prompt-over-HTTP) follows from
 * that split.
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
      BuilderQuestion,
      BuilderPullRequest,
      BuilderPrFeedback,
      BuilderReport,
      BuilderSettings,
      BuilderNotification,
      BuilderSteer,
    ]),
    PromptModule,
    LlmUsageModule,
    // The interview's provider-agnostic LLM access: AgentLlmProviderFactory
    // for the streamed tool loop, LlmCompletionService for the one-shot
    // transcript digest.
    LlmAgentModule,
    AuthModule,
    GithubModule,
    // For BugFindingService only: the gate's excused failures are filed as
    // Bug Hunter findings. A domain dependency, unlike the GitHub client that
    // used to be smuggled through this same import.
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
  controllers: [BuilderController, BuilderPipelineController],
  providers: [
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
    BuilderQuestionService,
    BuilderPullRequestService,
    BuilderReportService,
    BuilderSettingsService,
    BuilderLessonCuratorService,
    BuilderExemplarService,
    BuilderOutcomeService,
    BuilderMetricsService,
    BuilderEpicService,
    BuilderResearchService,
    BuilderNotificationService,
    BuilderSteerService,
    BuilderSchedulerRegistrationService,
    BuilderSessionRepository,
    BuilderMessageRepository,
    BuilderPrdDocRepository,
    BuilderPrdVersionRepository,
    BuilderRepoMapRepository,
    BuilderLessonRepository,
    BuilderExemplarRepository,
    BuilderBuildRunRepository,
    BuilderBuildEventRepository,
    BuilderQuestionRepository,
    BuilderPullRequestRepository,
    BuilderPrFeedbackRepository,
    BuilderReportRepository,
    BuilderNotificationRepository,
    BuilderSteerRepository,
  ],
  exports: [BuilderSessionService, BuilderKnowledgeService],
})
export class BuilderModule {}
