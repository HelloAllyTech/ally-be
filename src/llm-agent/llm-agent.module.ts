import { Module } from '@nestjs/common';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { LlmModule } from 'src/llm/llm.module';
import { AgentLlmProviderFactory } from './service/agent-llm.factory';
import { LlmCompletionService } from './service/llm-completion.service';
import { GlobalSettingsRepository } from 'src/settings/repository/global-settings.repository';
import { AgentTurnSettingsService } from './runtime/agent-turn-settings.service';

/**
 * Provider-agnostic LLM access for ally-be: streamed and tool-capable for the
 * agent loops, one-shot for everything else.
 *
 * Imported explicitly by the feature modules that make a call, rather than made
 * global: which surfaces can spend tokens is worth being able to read off the
 * module graph.
 *
 * `LlmUsageModule` rather than `AnalyticsModule` on purpose — it exists exactly
 * so a call site can record usage without pulling in the analytics dependency
 * graph and its cycles.
 *
 * `AgentTurnSettingsService` is the validated-turn runtime's kill switch, read
 * by each agent's orchestrator per turn. Its repository is provided here
 * rather than by importing SettingsModule, whose UserModule import would pull
 * the user graph into every agent module.
 */
@Module({
  imports: [LlmModule, LlmUsageModule],
  providers: [
    AgentLlmProviderFactory,
    LlmCompletionService,
    GlobalSettingsRepository,
    AgentTurnSettingsService,
  ],
  exports: [
    AgentLlmProviderFactory,
    LlmCompletionService,
    AgentTurnSettingsService,
  ],
})
export class LlmAgentModule {}
