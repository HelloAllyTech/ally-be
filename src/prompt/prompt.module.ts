import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiChatModule } from 'src/ai-chat/ai-chat.module';
import { LanguageModule } from 'src/language/language.module';
import { Prompt } from './entity/prompt.entity';
import { PromptVersion } from './entity/prompt-version.entity';
import { PromptTranslation } from './entity/prompt-translation.entity';
import { PromptsRepository } from './repository/prompt.repository';
import { PromptVersionRepository } from './repository/prompt-version.repository';
import { PromptTranslationRepository } from './repository/prompt-translation.repository';
import { PromptsService } from './service/prompt.service';
import { PromptSharedService } from './service/prompt-shared.service';
import { PromptsSyncService } from './service/prompts-sync.service';
import { PromptTranslationProviderService } from './service/prompt-translation-provider.service';
import { PromptTranslationTargetsService } from './service/prompt-translation-targets.service';
import { PromptTranslationService } from './service/prompt-translation.service';
import { PromptsController } from './controller/prompts.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Prompt, PromptVersion, PromptTranslation]),
    AiChatModule,
    LanguageModule,
  ],
  controllers: [PromptsController],
  providers: [
    PromptsRepository,
    PromptVersionRepository,
    PromptTranslationRepository,
    PromptsService,
    PromptSharedService,
    PromptsSyncService,
    PromptTranslationProviderService,
    PromptTranslationTargetsService,
    PromptTranslationService,
  ],
  exports: [
    PromptSharedService,
    PromptTranslationRepository,
    PromptTranslationService,
  ],
})
export class PromptModule {}
