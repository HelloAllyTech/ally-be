import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/config.module';
import { OpenAiLlmProvider } from './provider/openai-llm.provider';
import { GeminiLlmProvider } from './provider/gemini-llm.provider';
import { LlmProviderFactory } from './provider/llm-provider.factory';
import { AiChatService } from './service/ai-chat.service';

@Module({
  imports: [AppConfigModule],
  providers: [
    OpenAiLlmProvider,
    GeminiLlmProvider,
    LlmProviderFactory,
    AiChatService,
  ],
  exports: [AiChatService, LlmProviderFactory],
})
export class AiChatModule {}
