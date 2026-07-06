import { Module } from '@nestjs/common';
import { LlmController } from './controller/llm.controller';

/**
 * Owns the LLM model registry (single source of truth for selectable models +
 * their provider, temperature capability, and runtime support).
 */
@Module({
  controllers: [LlmController],
})
export class LlmModule {}
