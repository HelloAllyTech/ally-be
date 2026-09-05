import { Module } from '@nestjs/common';
import { AgentLlmProviderFactory } from './service/agent-llm.factory';

/**
 * Streamed, tool-capable LLM access for ally-be's agent loops.
 *
 * Imported explicitly by the feature modules that run one, rather than made
 * global: which surfaces can spend tokens on an agentic loop is worth being
 * able to read off the module graph.
 */
@Module({
  providers: [AgentLlmProviderFactory],
  exports: [AgentLlmProviderFactory],
})
export class LlmAgentModule {}
