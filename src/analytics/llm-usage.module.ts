import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmUsage } from './entity/llm-usage.entity';
import { LlmUsageService } from './service/llm-usage.service';

/**
 * Tiny, dependency-light module that owns the `llm_usage` entity + write path.
 * Kept separate from AnalyticsModule (which has heavy deps: UserModule →
 * LearnModule, etc.) so the call-site modules that need to RECORD usage
 * (LearnModule, CommonModule) can import it without a circular dependency.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LlmUsage])],
  providers: [LlmUsageService],
  exports: [LlmUsageService],
})
export class LlmUsageModule {}
