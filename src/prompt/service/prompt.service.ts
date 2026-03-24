import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, DeepPartial, In } from 'typeorm';
import { Prompt } from '../entity/prompt.entity';
import { PromptsRepository } from '../repository/prompt.repository';
import { PromptVersionRepository } from '../repository/prompt-version.repository';
import { PromptSharedService } from './prompt-shared.service';
import { UpdatePromptDto } from '../dto/update-prompt.dto';
import { CreatePromptsDto } from '../dto/create-prompts.dto';
import { SyncPromptsDto } from '../dto/sync-prompts.dto';
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
    private readonly promptSharedService: PromptSharedService,
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

    if (updatePromptDto.useDashboardOverride !== undefined) {
      updateData.useDashboardOverride = updatePromptDto.useDashboardOverride;
    }

    if (updatePromptDto.kind !== undefined) {
      updateData.kind = updatePromptDto.kind;
    }

    if (updatePromptDto.usesBlocks !== undefined) {
      updateData.usesBlocks = updatePromptDto.usesBlocks;
    }

    const updated = await this.promptsRepository.update(id, updateData);

    // If prompt content is being updated and dashboard override is enabled, create a new version
    const useDashboardOverride =
      updatePromptDto.useDashboardOverride !== undefined
        ? updatePromptDto.useDashboardOverride
        : prompt.useDashboardOverride;

    // Resolve content: from DTO, or when enabling override with no version yet, from default/file
    let contentToVersion: string | null =
      updatePromptDto.prompt?.trim() || null;
    if (
      !contentToVersion &&
      useDashboardOverride &&
      (prompt.currentVersion == null || prompt.currentVersion === undefined)
    ) {
      const fromDefault =
        prompt.defaultPrompt?.trim() ||
        (
          await this.promptSharedService.getPromptByCode(prompt.promptCode)
        )?.trim();
      contentToVersion = fromDefault || null;
    }

    if (contentToVersion && useDashboardOverride) {
      await this.dataSource.transaction(async () => {
        const latestVersion =
          await this.promptVersionRepository.getLatestPromptVersion(id);
        const newVersion = (latestVersion?.version || 0) + 1;

        // Create new version in transaction
        const promptVersion = this.promptVersionRepository.create({
          promptId: id,
          version: newVersion,
          prompt: contentToVersion,
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
  ): Promise<PromptResponse[]>;
  async getPrompts(
    searchName?: string,
    includeBlocks?: boolean,
    options?: Pagination,
  ): Promise<PromptResponse[]>;
  async getPrompts(
    searchName?: string,
    arg2?: boolean | Pagination,
    arg3?: Pagination,
  ): Promise<PromptResponse[]> {
    const includeBlocks = typeof arg2 === 'boolean' ? arg2 : true;
    const options = typeof arg2 === 'boolean' ? arg3 : arg2;

    const data = await this.promptsRepository.getPrompts(
      searchName,
      includeBlocks,
      options,
    );
    console.log(
      `getPrompts returned ${data.length} prompts. searchName: ${searchName}`,
    );
    for (const row of data) {
      if (!row.useDashboardOverride && row.promptCode) {
        const fromFolder = await this.promptSharedService.getPromptByCode(
          row.promptCode,
        );
        if (fromFolder !== null) {
          row.prompt = fromFolder;
        }
      }
    }
    return data;
  }

  async getPromptsByCodes(codes: string[]): Promise<Record<string, string>> {
    const prompts = await this.promptSharedService.getPromptsByOptions({
      promptCode: codes,
    });
    return (prompts ?? []).reduce<Record<string, string>>((acc, p) => {
      acc[p.promptCode] = p.prompt ?? '';
      return acc;
    }, {});
  }

  /**
   * Sync prompts from folder/codebase to DB. Add-only for new prompts;
   * for existing prompts, updates defaultPrompt only (preserves dashboard edits).
   * Automatically marks missing prompts as obsolete (grouping by ally_ai_learn vs native ally-be).
   */
  async syncPrompts(syncPromptsDto: SyncPromptsDto): Promise<{
    added: number;
    updated: number;
  }> {
    let added = 0;
    let updated = 0;

    const incomingCodes = syncPromptsDto.prompts.map((p) =>
      standardizePromptCode(p.promptCode),
    );
    const isFromAllyAiLearn = incomingCodes.some((code) =>
      code.startsWith('ally_ai_learn_'),
    );

    for (const item of syncPromptsDto.prompts) {
      const promptCode = standardizePromptCode(item.promptCode);
      const existing = await this.promptsRepository.findOne({
        where: { promptCode },
      });

      console.log(
        `Syncing ${promptCode}, prompt length: ${item.prompt?.length}`,
      );
      if (!existing) {
        const prompt = this.promptsRepository.create({
          promptCode,
          name: item.name,
          description: item.description || '',
          defaultPrompt: item.prompt,
          kind: item.kind,
          availableVariables: item.availableVariables,
          usesBlocks: item.usesBlocks,
          isObsolete: false,
        });
        const saved = await this.promptsRepository.save(prompt);

        const version = this.promptVersionRepository.create({
          promptId: saved.id,
          version: 1,
          prompt: item.prompt,
          createdBy: 0,
          updatedBy: 0,
        });
        await this.promptVersionRepository.save(version);
        await this.promptsRepository.update(saved.id, { currentVersion: 1 });
        added++;
      } else {
        await this.promptsRepository.update(existing.id, {
          defaultPrompt: item.prompt,
          name: item.name,
          description: item.description || '',
          kind: item.kind,
          availableVariables: item.availableVariables,
          usesBlocks: item.usesBlocks,
          isObsolete: false, // resurrected if it was obsolete
        });
        updated++;
      }
    }

    // Pass 2: Mark missing prompts as obsolete (scoped to the sync source)
    const query = this.promptsRepository.createQueryBuilder('prompt');

    const isFromAllyAi = incomingCodes.some(
      (code) =>
        code.startsWith('ally_ai_') && !code.startsWith('ally_ai_learn_'),
    );
    const isInternalBE = incomingCodes.some((code) =>
      code.startsWith('openai_'),
    );

    if (isFromAllyAiLearn) {
      query.where('prompt.promptCode LIKE :prefix', {
        prefix: 'ally_ai_learn_%',
      });
    } else if (isFromAllyAi) {
      query
        .where('prompt.promptCode LIKE :prefix', { prefix: 'ally_ai_%' })
        .andWhere('prompt.promptCode NOT LIKE :learnPrefix', {
          learnPrefix: 'ally_ai_learn_%',
        });
    } else if (isInternalBE) {
      query.where('prompt.promptCode LIKE :prefix', { prefix: 'openai_%' });
    } else {
      // If we don't recognize the prefix pattern, skip auto-obsolescence
      // to avoid accidentally nuking prompts from other services.
      return { added, updated };
    }

    if (incomingCodes.length > 0) {
      query.andWhere('prompt.promptCode NOT IN (:...incomingCodes)', {
        incomingCodes,
      });
    }
    query.andWhere('prompt.isObsolete = :isObsolete', { isObsolete: false });

    const obsoletePrompts = await query.getMany();
    if (obsoletePrompts.length > 0) {
      await this.promptsRepository.update(
        { id: In(obsoletePrompts.map((p) => p.id)) },
        { isObsolete: true },
      );
    }

    return { added, updated };
  }

  async deleteObsoletePrompt(id: string): Promise<void> {
    const prompt = await this.promptsRepository.findOne({ where: { id } });
    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }
    if (!prompt.isObsolete) {
      throw new Error('Only obsolete prompts can be deleted');
    }
    await this.promptVersionRepository.delete({ promptId: id });
    await this.promptsRepository.delete(id);
  }

  /**
   * Revert prompt to codebase default (copies defaultPrompt into new version).
   */
  async revertPrompt(id: string): Promise<boolean> {
    const prompt = await this.promptsRepository.findOne({ where: { id } });
    if (!prompt) {
      throw new NotFoundException('Prompt not found');
    }
    if (!prompt.defaultPrompt) {
      throw new NotFoundException(
        'Cannot revert: no default prompt (not synced from codebase)',
      );
    }

    const userId = Number(ExecutionManager.getUserId());
    const latestVersion =
      await this.promptVersionRepository.getLatestPromptVersion(id);
    const newVersion = (latestVersion?.version || 0) + 1;

    const promptVersion = this.promptVersionRepository.create({
      promptId: id,
      version: newVersion,
      prompt: prompt.defaultPrompt,
      createdBy: userId,
      updatedBy: userId,
    });
    await this.promptVersionRepository.save(promptVersion);
    await this.promptsRepository.update(id, { currentVersion: newVersion });

    const minVersionToKeep = Math.max(
      1,
      newVersion - (PROMPT_VERSION_RETENTION_LIMIT - 1),
    );
    await this.promptVersionRepository.deleteVersionsBefore(
      id,
      minVersionToKeep,
    );

    return true;
  }
}
