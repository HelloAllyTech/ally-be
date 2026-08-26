import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { AuthModule } from 'src/auth/auth.module';
import { BugHunterModule } from 'src/bug-hunter/bug-hunter.module';
import { BuilderSession } from './entity/builder-session.entity';
import { BuilderMessage } from './entity/builder-message.entity';
import { BuilderPrdDoc } from './entity/builder-prd-doc.entity';
import { BuilderPrdVersion } from './entity/builder-prd-version.entity';
import { BuilderRepoMap } from './entity/builder-repo-map.entity';
import { BuilderLesson } from './entity/builder-lesson.entity';
import { BuilderBuildRun } from './entity/builder-build-run.entity';
import { BuilderBuildEvent } from './entity/builder-build-event.entity';
import { BuilderQuestion } from './entity/builder-question.entity';
import { BuilderPullRequest } from './entity/builder-pull-request.entity';
import { BuilderReport } from './entity/builder-report.entity';
import { BuilderSettings } from './entity/builder-settings.entity';
import { BuilderNotification } from './entity/builder-notification.entity';
import { BuilderController } from './controller/builder.controller';
import { BuilderPipelineController } from './controller/builder-pipeline.controller';
import { BuilderGateway } from './gateway/builder.gateway';
import { BuilderSessionService } from './service/builder-session.service';
import { BuilderPrdService } from './service/builder-prd.service';
import { BuilderKnowledgeService } from './service/builder-knowledge.service';
import { BuilderGithubReadService } from './service/builder-github-read.service';
import { BuilderStacksService } from './service/builder-stacks.service';
import { BuilderInterviewToolsService } from './service/builder-interview-tools.service';
import { BuilderInterviewOrchestratorService } from './service/builder-interview-orchestrator.service';
import { BuilderBuildService } from './service/builder-build.service';
import { BuilderEventService } from './service/builder-event.service';
import { BuilderQuestionService } from './service/builder-question.service';
import { BuilderPullRequestService } from './service/builder-pull-request.service';
import { BuilderReportService } from './service/builder-report.service';
import { BuilderSettingsService } from './service/builder-settings.service';
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
  BuilderRepoMapRepository,
} from './repository/builder-knowledge.repository';
import {
  BuilderBuildEventRepository,
  BuilderBuildRunRepository,
  BuilderNotificationRepository,
  BuilderPullRequestRepository,
  BuilderQuestionRepository,
  BuilderReportRepository,
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
 * `BugHunterModule` is imported for `GithubActionsService` — the same
 * dispatch/cancel client, reused rather than forked. Pulling it into a shared
 * `src/github/` module is worthwhile once a third caller appears.
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
      BuilderBuildRun,
      BuilderBuildEvent,
      BuilderQuestion,
      BuilderPullRequest,
      BuilderReport,
      BuilderSettings,
      BuilderNotification,
    ]),
    PromptModule,
    LlmUsageModule,
    AuthModule,
    BugHunterModule,
  ],
  controllers: [BuilderController, BuilderPipelineController],
  providers: [
    BuilderGateway,
    BuilderSessionService,
    BuilderPrdService,
    BuilderKnowledgeService,
    BuilderGithubReadService,
    BuilderStacksService,
    BuilderInterviewToolsService,
    BuilderInterviewOrchestratorService,
    BuilderBuildService,
    BuilderEventService,
    BuilderQuestionService,
    BuilderPullRequestService,
    BuilderReportService,
    BuilderSettingsService,
    BuilderNotificationService,
    BuilderSchedulerRegistrationService,
    BuilderSessionRepository,
    BuilderMessageRepository,
    BuilderPrdDocRepository,
    BuilderPrdVersionRepository,
    BuilderRepoMapRepository,
    BuilderLessonRepository,
    BuilderBuildRunRepository,
    BuilderBuildEventRepository,
    BuilderQuestionRepository,
    BuilderPullRequestRepository,
    BuilderReportRepository,
    BuilderNotificationRepository,
  ],
  exports: [BuilderSessionService, BuilderKnowledgeService],
})
export class BuilderModule {}
