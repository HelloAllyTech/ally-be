import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Prompt } from './entity/prompt.entity';
import { PromptVersion } from './entity/prompt-version.entity';
import { PromptsRepository } from './repository/prompt.repository';
import { PromptVersionRepository } from './repository/prompt-version.repository';
import { PromptsService } from './service/prompt.service';
import { PromptsController } from './controller/prompts.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Prompt, PromptVersion])],
  controllers: [PromptsController],
  providers: [PromptsRepository, PromptVersionRepository, PromptsService],
  exports: [PromptsService],
})
export class PromptModule {}
