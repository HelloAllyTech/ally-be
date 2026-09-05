import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmController } from './controller/llm.controller';
import { LlmModels } from './entity/llm-models.entity';
import { LlmModelsRepository } from './repository/llm-models.repository';
import { AiTaskService } from './service/ai-task.service';
import { LlmModelService } from './service/llm-model.service';

/**
 * Owns the LLM model catalog: the selectable models and their temperature
 * capability, joined at read time with the in-code provider×runtime matrix.
 *
 * Also serves the AI task registry (`GET /v1/llm/tasks`) — the same subject read
 * the other way round: not which models exist, but which calls use them.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LlmModels])],
  controllers: [LlmController],
  providers: [LlmModelService, LlmModelsRepository, AiTaskService],
  exports: [LlmModelService, LlmModelsRepository, AiTaskService],
})
export class LlmModule {}
