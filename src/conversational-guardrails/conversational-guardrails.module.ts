import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationalGuardrails } from './entity/conversational-guardrails.entity';
import { ConversationalGuardrailsTranslations } from './entity/conversational-guardrails-translations.entity';
import { ConversationalGuardrailsController } from './controller/conversational-guardrails.controller';
import { ConversationalGuardrailsService } from './service/conversational-guardrails.service';
import { ConversationalGuardrailsRepository } from './repository/conversational-guardrails.repository';
import { ConversationalGuardrailsTranslationsRepository } from './repository/conversational-guardrails-translations.repository';
import { ConversationalGuardrailsTranslationService } from './service/conversational-guardrails-translation.service';
import { LanguageModule } from 'src/language/language.module';
import { CommonModule } from 'src/common/common.module';
import { LearnModule } from 'src/learn/learn.module';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ConversationalGuardrails,
      ConversationalGuardrailsTranslations,
    ]),
    LanguageModule,
    CommonModule,
    forwardRef(() => LearnModule),
  ],
  controllers: [ConversationalGuardrailsController],
  providers: [
    ConversationalGuardrailsService,
    ConversationalGuardrailsRepository,
    ConversationalGuardrailsTranslationsRepository,
    ConversationalGuardrailsTranslationService,
  ],
  exports: [
    ConversationalGuardrailsService,
    ConversationalGuardrailsTranslationService,
  ],
})
export class ConversationalGuardrailsModule {}
