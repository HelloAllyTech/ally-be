import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';
import { AwsModule } from 'src/aws/aws.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { CaseModule } from 'src/case/case.module';
import { ImageGenerationModule } from 'src/image-generation/image-generation.module';
import { LearnModule } from 'src/learn/learn.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { StacksClientService } from 'src/llm-agent/service/stacks-client.service';
import { PromptModule } from 'src/prompt/prompt.module';
import { ScenarioCharacterModule } from 'src/scenario-character/scenario-character.module';
import { TrackModule } from 'src/track/track.module';
import { CourseCopilotController } from './controller/course-copilot.controller';
import { CourseCopilotEvent } from './entity/course-copilot-event.entity';
import { CourseCopilotJob } from './entity/course-copilot-job.entity';
import { CourseCopilotMessage } from './entity/course-copilot-message.entity';
import { CourseCopilotSession } from './entity/course-copilot-session.entity';
import { CourseCopilotGateway } from './gateway/course-copilot.gateway';
import {
  CourseCopilotEventRepository,
  CourseCopilotJobRepository,
  CourseCopilotMessageRepository,
  CourseCopilotSessionRepository,
} from './repository/course-copilot.repository';
import { CourseCopilotAnalyticsService } from './service/course-copilot-analytics.service';
import { CourseCopilotBlueprintService } from './service/course-copilot-blueprint.service';
import { CourseCopilotBriefService } from './service/course-copilot-brief.service';
import { CourseCopilotBuildService } from './service/course-copilot-build.service';
import { CourseCopilotCostService } from './service/course-copilot-cost.service';
import { CourseCopilotEditToolsService } from './service/course-copilot-edit-tools.service';
import { CourseCopilotEventService } from './service/course-copilot-event.service';
import { CourseCopilotJobExecutorService } from './service/course-copilot-job-executor.service';
import { CourseCopilotLandingPageService } from './service/course-copilot-landing-page.service';
import { CourseCopilotLibraryService } from './service/course-copilot-library.service';
import { CourseCopilotMediaService } from './service/course-copilot-media.service';
import { CourseCopilotOrchestratorService } from './service/course-copilot-orchestrator.service';
import { CourseCopilotSchedulerRegistrationService } from './service/course-copilot-scheduler-registration.service';
import { CourseCopilotSessionService } from './service/course-copilot-session.service';
import { CourseCopilotStructureService } from './service/course-copilot-structure.service';
import { CourseCopilotToolsService } from './service/course-copilot-tools.service';
import { AnnotationSpecialist } from './service/specialists/annotation.specialist';
import { ArticleSpecialist } from './service/specialists/article.specialist';
import { BlueprintPlannerSpecialist } from './service/specialists/blueprint-planner.specialist';
import { CourseMetaSpecialist } from './service/specialists/course-meta.specialist';
import { CourseReviewSpecialist } from './service/specialists/course-review.specialist';
import { ImagePromptSpecialist } from './service/specialists/image-prompt.specialist';
import { JournalSpecialist } from './service/specialists/journal.specialist';
import { LandingPageSpecialist } from './service/specialists/landing-page.specialist';
import { QuizSpecialist } from './service/specialists/quiz.specialist';
import { RoleplayBriefSpecialist } from './service/specialists/roleplay-brief.specialist';
import { SpecialistLlmService } from './service/specialists/specialist-llm.service';

/**
 * Course Copilot — see docs/course-copilot.md.
 *
 * A leaf module: it reads and writes courses, roleplays and cases through
 * their owners' own services (exported for it), and nothing imports it back,
 * so it adds no edge to the existing module cycles.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CourseCopilotSession,
      CourseCopilotMessage,
      CourseCopilotJob,
      CourseCopilotEvent,
    ]),
    // WebSocketAuthMiddleware for the /course-copilot gateway.
    AuthModule,
    AwsModule,
    CaseModule,
    ImageGenerationModule,
    LearnModule,
    LlmAgentModule,
    LlmUsageModule,
    PromptModule,
    ScenarioCharacterModule,
    TrackModule,
  ],
  controllers: [CourseCopilotController],
  providers: [
    CourseCopilotSessionRepository,
    CourseCopilotMessageRepository,
    CourseCopilotJobRepository,
    CourseCopilotEventRepository,
    StacksClientService,
    CourseCopilotEventService,
    CourseCopilotAnalyticsService,
    CourseCopilotGateway,
    CourseCopilotBriefService,
    CourseCopilotLibraryService,
    CourseCopilotCostService,
    CourseCopilotStructureService,
    CourseCopilotSessionService,
    CourseCopilotMediaService,
    CourseCopilotBlueprintService,
    CourseCopilotJobExecutorService,
    CourseCopilotBuildService,
    CourseCopilotEditToolsService,
    CourseCopilotToolsService,
    CourseCopilotOrchestratorService,
    CourseCopilotSchedulerRegistrationService,
    CourseCopilotLandingPageService,
    SpecialistLlmService,
    BlueprintPlannerSpecialist,
    ArticleSpecialist,
    QuizSpecialist,
    JournalSpecialist,
    AnnotationSpecialist,
    CourseMetaSpecialist,
    CourseReviewSpecialist,
    ImagePromptSpecialist,
    RoleplayBriefSpecialist,
    LandingPageSpecialist,
  ],
})
export class CourseCopilotModule {}
