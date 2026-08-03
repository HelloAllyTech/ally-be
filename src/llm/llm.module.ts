import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmController } from './controller/llm.controller';
import { LlmModels } from './entity/llm-models.entity';
import { LlmModelsRepository } from './repository/llm-models.repository';
import { LlmModelService } from './service/llm-model.service';

/**
 * Owns the LLM model catalog: the selectable models and their temperature
 * capability, joined at read time with the in-code provider×runtime matrix.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LlmModels])],
  controllers: [LlmController],
  providers: [LlmModelService, LlmModelsRepository],
  exports: [LlmModelService, LlmModelsRepository],
})
export class LlmModule {}
