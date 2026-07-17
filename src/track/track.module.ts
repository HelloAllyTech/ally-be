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
import { TrackJournalService } from './service/track-journal.service';
import { TrackRepository } from './repository/track.repository';
import { TrackSectionRepository } from './repository/track-section.repository';
import { TrackItemRepository } from './repository/track-item.repository';
import { TrackTenantRepository } from './repository/track-tenant.repository';
import { TrackEnrollmentRepository } from './repository/track-enrollment.repository';
import { TrackItemProgressRepository } from './repository/track-item-progress.repository';
import { TrackQuizAttemptRepository } from './repository/track-quiz-attempt.repository';
import { TrackJournalEntryRepository } from './repository/track-journal-entry.repository';

@Module({
  imports: [
    forwardRef(() => LearnModule),
    forwardRef(() => CaseModule),
    TenantModule,
    LanguageModule,
    AwsModule,
    forwardRef(() => PromptModule),
    LlmUsageModule,
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
    TrackJournalService,
    TrackRepository,
    TrackSectionRepository,
    TrackItemRepository,
    TrackTenantRepository,
    TrackEnrollmentRepository,
    TrackItemProgressRepository,
    TrackQuizAttemptRepository,
    TrackJournalEntryRepository,
  ],
  exports: [TrackSharedService, TrackProgressService],
})
export class TrackModule {}
