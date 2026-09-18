import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/config.module';
import { LearnModule } from 'src/learn/learn.module';
import { LlmModule } from 'src/llm/llm.module';
import { LlmPreviewController } from './llm-preview.controller';
import { LlmPreviewService } from './llm-preview.service';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';

@Module({
  imports: [AppConfigModule, LearnModule, LlmModule, LlmAgentModule],
  controllers: [LlmPreviewController],
  providers: [LlmPreviewService],
})
export class LlmPreviewModule {}
