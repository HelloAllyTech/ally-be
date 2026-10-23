import { Global, Module } from '@nestjs/common';
import { CryptoService } from './service/crypto.service';
import { GoogleTranslationsService } from './service/google-translation.service';
import { OpenAITranslationsService } from './service/openai-translation.service';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { AiChatModule } from 'src/ai-chat/ai-chat.module';
import { FaviconController } from './controller/favicon.controller';

@Global()
@Module({
  imports: [PromptModule, LlmUsageModule, AiChatModule],
  controllers: [FaviconController],
  providers: [
    CryptoService,
    GoogleTranslationsService,
    OpenAITranslationsService,
  ],
  exports: [
    CryptoService,
    GoogleTranslationsService,
    OpenAITranslationsService,
  ],
})
export class CommonModule {}
