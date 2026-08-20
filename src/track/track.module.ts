import { CohortModule } from 'src/cohort/cohort.module';
import { forwardRef, Module } from '@nestjs/common';
import { LearnModule } from 'src/learn/learn.module';
import { TenantModule } from 'src/tenant/tenant.module';
import { LanguageModule } from 'src/language/language.module';
import { AwsModule } from 'src/aws/aws.module';
import { CaseModule } from 'src/case/case.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { TrackAdminController } from './controller/track-admin.controller';
import { TrackLearnerController } from './controller/track-learner.controller';
import { TrackService } from './service/track.service';
import { TrackSharedService } from './service/track-shared.service';
import { TrackTenantService } from './service/track-tenant.service';
import { TrackMediaService } from './service/track-media.service';
import { TrackProgressService } from './service/track-progress.service';
import { TrackEnrollmentService } from './service/track-enrollment.service';
import { TrackQuizService } from './service/track-quiz.service';
import { TrackQuizLlmGraderService } from './service/track-quiz-llm-grader.service';
import { TrackAnnotationService } from './service/track-annotation.service';
import { TrackGameService } from './service/track-game.service';
import { TrackMemoryService } from './service/track-memory.service';
import { TrackJournalService } from './service/track-journal.service';
import { TrackRepository } from './repository/track.repository';
import { TrackSectionRepository } from './repository/track-section.repository';
import { TrackItemRepository } from './repository/track-item.repository';
import { TrackTenantRepository } from './repository/track-tenant.repository';
import { TrackEnrollmentRepository } from './repository/track-enrollment.repository';
import { TrackItemProgressRepository } from './repository/track-item-progress.repository';
import { TrackQuizAttemptRepository } from './repository/track-quiz-attempt.repository';
import { TrackAnnotationAttemptRepository } from './repository/track-annotation-attempt.repository';
import { TrackJournalEntryRepository } from './repository/track-journal-entry.repository';
import { TrackTranslationRepository } from './repository/track-translation.repository';
import { TrackTranslationService } from './service/track-translation.service';
import { TrackTranslationJobService } from './service/track-translation-job.service';
import { TrackTranslationNotificationService } from './service/track-translation-notification.service';
import { TrackLocalizationService } from './service/track-localization.service';
import { TrackTranslationGateway } from './gateway/track-translation.gateway';

@Module({
  imports: [
    forwardRef(() => LearnModule),
    forwardRef(() => CaseModule),
    TenantModule,
    LanguageModule,
    AwsModule,
    forwardRef(() => PromptModule),
    LlmUsageModule,
    CohortModule,
  ],
  controllers: [TrackAdminController, TrackLearnerController],
  providers: [
    TrackService,
    TrackSharedService,
    TrackTenantService,
    TrackMediaService,
    TrackProgressService,
    TrackEnrollmentService,
    TrackQuizService,
    TrackQuizLlmGraderService,
    TrackAnnotationService,
    TrackGameService,
    TrackMemoryService,
    TrackJournalService,
    TrackRepository,
    TrackSectionRepository,
    TrackItemRepository,
    TrackTenantRepository,
    TrackEnrollmentRepository,
    TrackItemProgressRepository,
    TrackQuizAttemptRepository,
    TrackAnnotationAttemptRepository,
    TrackJournalEntryRepository,
    TrackTranslationRepository,
    TrackTranslationService,
    TrackTranslationJobService,
    TrackTranslationNotificationService,
    TrackLocalizationService,
    TrackTranslationGateway,
  ],
  exports: [
    TrackSharedService,
    TrackProgressService,
    TrackMemoryService,
    TrackLocalizationService,
  ],
})
export class TrackModule {}
