import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmController } from './controller/llm.controller';
import { LlmModels } from './entity/llm-models.entity';
import { LlmModelsRepository } from './repository/llm-models.repository';
import { AiTaskService } from './service/ai-task.service';
import { LlmModelService } from './service/llm-model.service';
import { LlmTargetResolverService } from './service/llm-target-resolver.service';

/**
 * Owns the LLM model catalog: the selectable models and their temperature
 * capability, joined at read time with the in-code provider×runtime matrix.
 *
 * Also serves the AI task registry (`GET /v1/llm/tasks`) — the same subject read
 * the other way round: not which models exist, but which calls use them. That
 * endpoint is read-only by design: it reports which model serves each call, and
 * `LlmTargetResolverService` is what makes the report true rather than a
 * transcription of defaults.
 *
 * PromptModule is imported for the prompt-row rung of that chain, and imports
 * nothing from here, so the direction stays one-way.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LlmModels]), PromptModule],
  controllers: [LlmController],
  providers: [
    LlmModelService,
    LlmModelsRepository,
    LlmTargetResolverService,
    AiTaskService,
  ],
  exports: [
    LlmModelService,
    LlmModelsRepository,
    LlmTargetResolverService,
    AiTaskService,
  ],
})
export class LlmModule {}
