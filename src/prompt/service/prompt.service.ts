import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Prompt } from '../entity/prompt.entity';
import { PromptsRepository } from '../repository/prompt.repository';
import { PromptVersionRepository } from '../repository/prompt-version.repository';
import { UpdatePromptDto } from '../dto/update-prompt.dto';
import { CreatePromptsDto } from '../dto/create-prompts.dto';
import { DeepPartial } from 'typeorm';
import { Pagination } from 'src/common/type/common.type';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { PromptResponse } from '../type/prompt-response.type';
import { standardizePromptCode } from '../util/prompt-code.util';
import { PROMPT_VERSION_RETENTION_LIMIT } from '../constants/prompt.constants';

@Injectable()
export class PromptsService {
  constructor(
    private readonly promptsRepository: PromptsRepository,
    private readonly promptVersionRepository: PromptVersionRepository,
    private readonly dataSource: DataSource,
  ) {}

  async createPrompts(createPromptsDto: CreatePromptsDto): Promise<Prompt[]> {
    const userId = Number(ExecutionManager.getUserId());
    const prompts = createPromptsDto.prompts.map((promptDto) =>
      this.promptsRepository.create({
        promptCode: standardizePromptCode(promptDto.promptCode),
        name: promptDto.name,
        description: promptDto.description || '',
      }),
    );

    const savedPrompts = await this.promptsRepository.save(prompts);

    // Create initial versions for all prompts
    const promptVersions = savedPrompts.map((savedPrompt) =>
      this.promptVersionRepository.create({
        promptId: savedPrompt.id,
        version: 1,
        prompt:
          createPromptsDto.prompts.find(
            (p) =>
              standardizePromptCode(p.promptCode) === savedPrompt.promptCode,
          )?.prompt || '',
        createdBy: userId,
        updatedBy: userId,
      }),
    );

    await this.promptVersionRepository.save(promptVersions);

    // Update all prompts with current version
    const updatedPrompts = savedPrompts.map((prompt) => ({
      ...prompt,
      currentVersion: 1,
    }));
    await this.promptsRepository.save(updatedPrompts);

    return savedPrompts;
  }

  async updatePrompt(
    id: string,
    updatePromptDto: UpdatePromptDto,
  ): Promise<boolean> {
    const userId = Number(ExecutionManager.getUserId());
    const prompt = await this.promptsRepository.findOne({
      where: { id },
    });

    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }

    const updateData: DeepPartial<Prompt> = {};

    if (updatePromptDto.promptCode) {
      updateData.promptCode = updatePromptDto.promptCode;
    }

    if (updatePromptDto.name) {
      updateData.name = updatePromptDto.name;
    }

    if (updatePromptDto.description !== undefined) {
      updateData.description = updatePromptDto.description;
    }

    const updated = await this.promptsRepository.update(id, updateData);

    // If prompt content is being updated, create a new version and apply retention policy
    if (updatePromptDto.prompt) {
      await this.dataSource.transaction(async () => {
        const latestVersion =
          await this.promptVersionRepository.getLatestPromptVersion(id);
        const newVersion = (latestVersion?.version || 0) + 1;

        // Create new version in transaction
        const promptVersion = this.promptVersionRepository.create({
          promptId: id,
          version: newVersion,
          prompt: updatePromptDto.prompt,
          createdBy: userId,
          updatedBy: userId,
        });

        await this.promptVersionRepository.save(promptVersion);

        // Update current version
        await this.promptsRepository.update(id, {
          currentVersion: newVersion,
        });

        // Apply retention policy: delete versions older than limit
        const minVersionToKeep = Math.max(
          1,
          newVersion - (PROMPT_VERSION_RETENTION_LIMIT - 1),
        );
        await this.promptVersionRepository.deleteVersionsBefore(
          id,
          minVersionToKeep,
        );
      });
    }

    return updated.affected !== 0;
  }

  async getPrompts(
    searchName?: string,
    options?: Pagination,
  ): Promise<PromptResponse[]> {
    const data = await this.promptsRepository.getPrompts(searchName, options);
    return data;
  }
}
