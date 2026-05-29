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
import { parseVariablesFromPrompt } from '../util/parse-variables.util';
import { reconcileAvailableVariables } from '../util/normalize-available-variable.util';
import { PROMPT_VERSION_RETENTION_LIMIT } from '../constants/prompt.constants';
import { LoggerService } from 'src/logger/logger.service';

@Injectable()
export class PromptsService {
  private readonly logger = LoggerService.getInstance(PromptsService.name);

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
        category: promptDto.category,
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

    if (updatePromptDto.category !== undefined) {
      updateData.category = updatePromptDto.category;
    }

    if (updatePromptDto.useDashboardOverride !== undefined) {
      updateData.useDashboardOverride = updatePromptDto.useDashboardOverride;

      // Restore-to-default path: when the admin flips override true → false,
      // re-derive `availableVariables` from `defaultPrompt` so the studio's
      // chip list immediately matches the file's authored baseline instead
      // of lingering on whatever the dashboard-edited version had. The
      // dashboard-edit path covers the opposite direction (auto-reconcile
      // runs inside the transaction below when a new version is committed).
      if (
        updatePromptDto.useDashboardOverride === false &&
        prompt.useDashboardOverride === true &&
        prompt.defaultPrompt
      ) {
        const parsedNames = parseVariablesFromPrompt(prompt.defaultPrompt);
        updateData.availableVariables = reconcileAvailableVariables(
          prompt.availableVariables,
          parsedNames,
        );
      }
    }

    if (updatePromptDto.kind !== undefined) {
      updateData.kind = updatePromptDto.kind;
    }

    if (updatePromptDto.promptType !== undefined) {
      updateData.promptType = updatePromptDto.promptType;
    }

    if (updatePromptDto.hasStates !== undefined) {
      updateData.hasStates = updatePromptDto.hasStates;
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

        // Reconcile availableVariables against the new text so studio
        // readers (and any required-field check) reflect what the prompt
        // actually references after this edit. Removed placeholders drop
        // out of the variable list; survivors keep their per-variable
        // metadata (label / required); newly-typed `{placeholders}` are
        // appended as bare `{ name }` entries.
        const parsedNames = parseVariablesFromPrompt(contentToVersion);
        const reconciled = reconcileAvailableVariables(
          prompt.availableVariables,
          parsedNames,
        );
        await this.promptsRepository.update(id, {
          availableVariables: reconciled,
        });
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
   * List variants for a given promptType (e.g. 'main_agent').
   * Used by the studio prompt picker. Excludes obsolete rows. For each row,
   * if useDashboardOverride is false the .prompt field is hydrated from the
   * codebase default, mirroring getPrompts() semantics.
   */
  async getPromptsByType(promptType: string): Promise<PromptResponse[]> {
    const data = await this.promptsRepository.getPromptsByType(promptType);
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

  /**
   * Duplicate a prompt into a new variant row. Copies prompt text, metadata,
   * promptType, hasStates, availableVariables, usesBlocks. Generates a new
   * promptCode (`<source>_copy_<short-id>`) and name. Sets useDashboardOverride
   * true and creates an initial version, so the new variant lives in DB-backed
   * metadata (the path that resolver_by_code looks up).
   */
  async duplicatePrompt(sourceId: string): Promise<Prompt> {
    const userId = Number(ExecutionManager.getUserId());

    const source = await this.promptsRepository.findOne({
      where: { id: sourceId },
    });
    if (!source) {
      throw new NotFoundException('Source prompt not found');
    }

    // Resolve content: prefer the current published version, fall back to
    // defaultPrompt, then to the codebase default. Without content there's
    // nothing useful to duplicate.
    let sourceContent: string | null = null;
    if (source.currentVersion != null) {
      const v = await this.promptVersionRepository.findOne({
        where: { promptId: source.id, version: source.currentVersion },
      });
      sourceContent = v?.prompt ?? null;
    }
    if (!sourceContent) {
      sourceContent =
        source.defaultPrompt ??
        (await this.promptSharedService.getPromptByCode(source.promptCode)) ??
        null;
    }
    if (!sourceContent) {
      throw new NotFoundException('Source prompt has no content to duplicate');
    }

    // Re-reconcile availableVariables against the actual content being
    // duplicated. Source's `availableVariables` could be stale (manual
    // trims via prompt management leave entries that don't match the
    // current text). Walking the text now guarantees the duplicate
    // starts with a consistent variable list.
    const sourceParsedNames = parseVariablesFromPrompt(sourceContent);
    const reconciledAvailableVariables = reconcileAvailableVariables(
      source.availableVariables,
      sourceParsedNames,
    );

    const newName = `${source.name} (copy)`;
    // Rule: every main-agent variant except the file-backed default carries
    // states. Duplicates (which only exist in DB and never sync from file)
    // are by definition not the default, so we force hasStates=true here
    // regardless of the source row's flag. The studio no longer surfaces a
    // Has-States toggle in prompt management; this is the single place that
    // decides the new variant's value.
    const newHasStates =
      source.promptType === 'main_agent' ? true : source.hasStates;

    // Retry the insert on `promptCode` unique-constraint collision. ShortId
    // uses ms-timestamp + 4-digit base36 randomness; collision is rare but
    // possible when two admins duplicate the same source within the same
    // millisecond and roll the same random suffix. A single retry with a
    // fresh shortId is overwhelmingly likely to succeed.
    const MAX_DUPLICATE_RETRIES = 3;
    let saved: Prompt | null = null;
    for (let attempt = 0; attempt < MAX_DUPLICATE_RETRIES; attempt++) {
      const shortId =
        Date.now().toString(36) +
        Math.floor(Math.random() * 1e4)
          .toString(36)
          .padStart(3, '0');
      const newPromptCode = standardizePromptCode(
        `${source.promptCode}_copy_${shortId}`,
      );
      const created = this.promptsRepository.create({
        promptCode: newPromptCode,
        name: newName,
        description: source.description,
        category: source.category,
        defaultPrompt: source.defaultPrompt,
        useDashboardOverride: true,
        isObsolete: false,
        kind: source.kind,
        promptType: source.promptType,
        hasStates: newHasStates,
        availableVariables: reconciledAvailableVariables,
        usesBlocks: source.usesBlocks,
      });
      try {
        saved = await this.promptsRepository.save(created);
        break;
      } catch (err: unknown) {
        const driverError =
          (err as { code?: string; driverError?: { code?: string } })
            ?.driverError ?? (err as { code?: string });
        const isUniqueViolation =
          driverError?.code === '23505'; /* Postgres unique_violation */
        if (!isUniqueViolation || attempt === MAX_DUPLICATE_RETRIES - 1) {
          throw err;
        }
        this.logger.warn(
          `[PROMPT_DUPLICATE] retry attempt=${attempt + 1}/${MAX_DUPLICATE_RETRIES} ` +
            `sourceId=${sourceId} reason=unique_violation_promptCode`,
        );
        // Brief stagger so the next Date.now() is at least 1ms ahead.
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
    if (!saved) {
      throw new Error('duplicatePrompt: failed to save after retries');
    }

    const version = this.promptVersionRepository.create({
      promptId: saved.id,
      version: 1,
      prompt: sourceContent,
      createdBy: userId,
      updatedBy: userId,
    });
    await this.promptVersionRepository.save(version);
    await this.promptsRepository.update(saved.id, { currentVersion: 1 });

    saved.currentVersion = 1;
    return saved;
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

      // Demoted to debug — fires once per prompt on every container
      // boot (~30 lines). The aggregate "added/updated" line at the end
      // of syncPrompts is the useful one for INFO.
      this.logger.debug(
        `[PROMPT_SYNC] processing promptCode=${promptCode} bodyChars=${item.prompt?.length ?? 0}`,
      );
      if (!existing) {
        const prompt = this.promptsRepository.create({
          promptCode,
          name: item.name,
          description: item.description || '',
          category: item.category,
          defaultPrompt: item.prompt,
          kind: item.kind,
          promptType: item.promptType,
          hasStates: item.hasStates,
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
        // Sync updates split by `useDashboardOverride`:
        //
        //   - `defaultPrompt` (the file's text) is ALWAYS refreshed from
        //     the file so the Revert-to-default button can restore the
        //     latest authored baseline.
        //
        //   - `name`, `description`, `category`, `kind`, `usesBlocks` are
        //     file-driven metadata that sync owns end-to-end.
        //
        //   - `availableVariables` is the placeholder list the studio
        //     reads. When `useDashboardOverride=true`, the dashboard's
        //     auto-reconcile on save is the source of truth (it reflects
        //     the live edited text in prompt_versions). Sync MUST NOT
        //     overwrite it for dashboard-overridden rows, or the next
        //     restart silently undoes the author's intentional removals.
        //     For non-overridden rows, sync owns it.
        //
        //   - `promptType` / `hasStates` are only overwritten when the
        //     payload explicitly carries them (backfilled values stay
        //     intact when older sync sources omit them).
        const updatePayload: Partial<Prompt> = {
          defaultPrompt: item.prompt,
          name: item.name,
          description: item.description || '',
          category: item.category,
          kind: item.kind,
          usesBlocks: item.usesBlocks,
          isObsolete: false, // resurrected if it was obsolete
        };
        // Update `availableVariables` from the sync payload when EITHER
        // the row isn't dashboard-overridden (sync owns the list) OR the
        // existing row has no list yet (legacy / migration edge — without
        // this initialization the studio's chip list stays empty for
        // dashboard-overridden rows that were created before this column
        // existed, even though the prompt clearly references placeholders).
        const existingVarsCount = Array.isArray(existing.availableVariables)
          ? existing.availableVariables.length
          : 0;
        if (!existing.useDashboardOverride || existingVarsCount === 0) {
          updatePayload.availableVariables = item.availableVariables;
        } else {
          // Dashboard override active AND existing list non-empty: skip the
          // sync overwrite. Logged so we can confirm dashboard edits survive
          // restarts/redeploys (grep `[PROMPT_SYNC] preserved-vars`).
          this.logger.info(
            `[PROMPT_SYNC] preserved-vars promptCode=${promptCode} ` +
              `useDashboardOverride=true existingCount=${existingVarsCount} ` +
              `syncCount=${item.availableVariables?.length ?? 0}`,
          );
        }
        if (item.promptType !== undefined) {
          updatePayload.promptType = item.promptType;
        }
        if (item.hasStates !== undefined) {
          updatePayload.hasStates = item.hasStates;
        }
        await this.promptsRepository.update(existing.id, updatePayload);
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
