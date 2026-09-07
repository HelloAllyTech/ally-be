import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmController } from './controller/llm.controller';
import { LlmModels } from './entity/llm-models.entity';
import { LlmTaskConfig } from './entity/llm-task-config.entity';
import { LlmModelsRepository } from './repository/llm-models.repository';
import { LlmTaskConfigRepository } from './repository/llm-task-config.repository';
import { AiTaskService } from './service/ai-task.service';
import { LlmModelService } from './service/llm-model.service';
import { LlmTargetResolverService } from './service/llm-target-resolver.service';

/**
 * Owns the LLM model catalog: the selectable models and their temperature
 * capability, joined at read time with the in-code provider×runtime matrix.
 *
 * Also serves the AI task registry (`GET /v1/llm/tasks`) — the same subject read
 * the other way round: not which models exist, but which calls use them — and
 * `llm_task_configs`, the per-task selection behind it. The registry describes
 * the calls, the config table decides what serves them, and
 * `LlmTargetResolverService` is the one place the two are combined.
 *
 * PromptModule is imported for the prompt-row rung of that chain, and imports
 * nothing from here, so the direction stays one-way.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LlmModels, LlmTaskConfig]), PromptModule],
  controllers: [LlmController],
  providers: [
    LlmModelService,
    LlmModelsRepository,
    LlmTaskConfigRepository,
    LlmTargetResolverService,
    AiTaskService,
  ],
  exports: [
    LlmModelService,
    LlmModelsRepository,
    LlmTaskConfigRepository,
    LlmTargetResolverService,
    AiTaskService,
  ],
})
export class LlmModule {}
