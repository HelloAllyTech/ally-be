import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/config.module';
import { LearnModule } from 'src/learn/learn.module';
import { LlmModule } from 'src/llm/llm.module';
import { LlmPreviewController } from './llm-preview.controller';
import { LlmPreviewService } from './llm-preview.service';
import { LlmProviderFactory } from './providers/llm-provider.factory';

@Module({
  imports: [AppConfigModule, LearnModule, LlmModule],
  controllers: [LlmPreviewController],
  providers: [LlmPreviewService, LlmProviderFactory],
})
export class LlmPreviewModule {}
