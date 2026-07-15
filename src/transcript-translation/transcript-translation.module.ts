import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LanguageModule } from 'src/language/language.module';
import { ScenarioSessionMessageTranslation } from './entity/scenario-session-message-translation.entity';
import { ScenarioSessionMessageTranslationRepository } from './repository/scenario-session-message-translation.repository';
import { TranscriptTranslationService } from './service/transcript-translation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScenarioSessionMessageTranslation]),
    LanguageModule,
  ],
  providers: [
    ScenarioSessionMessageTranslationRepository,
    TranscriptTranslationService,
  ],
  exports: [TranscriptTranslationService],
})
export class TranscriptTranslationModule {}
