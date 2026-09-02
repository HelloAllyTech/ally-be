import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiChatModule } from 'src/ai-chat/ai-chat.module';
import { Prompt } from 'src/prompt/entity/prompt.entity';
import { PromptVersion } from 'src/prompt/entity/prompt-version.entity';
import { LanguageErrorAnnotation } from 'src/learn/entity/language-error-annotation.entity';
import { Languages } from './entity/languages.entity';
import { LanguageGlossarySection } from './entity/language-glossary-section.entity';
import { GlossaryAdherenceReport } from './entity/glossary-adherence-report.entity';
import { LanguageVarietyProfile } from './entity/language-variety-profile.entity';
import { VarietyProfileAttachment } from './entity/variety-profile-attachment.entity';
import { GlossaryConsolidationBatch } from './entity/glossary-consolidation-batch.entity';
import { GlossaryConsolidationSchedulerRegistrationService } from './service/glossary-consolidation-scheduler-registration.service';
import { LanguagesRepository } from './repository/languages.repository';
import { LanguageGlossaryRepository } from './repository/language-glossary.repository';
import { SharedLanguageService } from './service/shared-language.service';
import { LanguageController } from './controller/language.controller';
import { LanguageGlossaryController } from './controller/language-glossary.controller';
import { LanguageService } from './service/language.service';
import { LanguageGlossaryService } from './service/language-glossary.service';
import { GlossaryAdherenceSchedulerRegistrationService } from './service/glossary-adherence-scheduler-registration.service';
import { GlossaryAdherenceService } from './service/glossary-adherence.service';
import { GlossaryAdjudicationService } from './service/glossary-adjudication.service';
import { VarietyProfileController } from './controller/variety-profile.controller';
import { VarietyProfileService } from './service/variety-profile.service';
import { UserModule } from 'src/user/user.module';
@Module({
  imports: [
    // Prompt/PromptVersion are registered directly (not via PromptModule, which
    // imports LanguageModule — a cycle) so the glossary seed job can resolve
    // the `glossary_generation` registry prompt row.
    TypeOrmModule.forFeature([
      Languages,
      LanguageGlossarySection,
      GlossaryAdherenceReport,
      LanguageVarietyProfile,
      VarietyProfileAttachment,
      GlossaryConsolidationBatch,
      Prompt,
      PromptVersion,
      LanguageErrorAnnotation,
    ]),
    AiChatModule,
    forwardRef(() => UserModule),
  ],
  controllers: [
    LanguageController,
    LanguageGlossaryController,
    VarietyProfileController,
  ],
  providers: [
    LanguagesRepository,
    LanguageGlossaryRepository,
    SharedLanguageService,
    LanguageService,
    LanguageGlossaryService,
    GlossaryAdherenceService,
    GlossaryAdjudicationService,
    GlossaryAdherenceSchedulerRegistrationService,
    GlossaryConsolidationSchedulerRegistrationService,
    VarietyProfileService,
  ],
  exports: [
    SharedLanguageService,
    LanguageGlossaryService,
    GlossaryAdherenceService,
    VarietyProfileService,
  ],
})
export class LanguageModule {}
