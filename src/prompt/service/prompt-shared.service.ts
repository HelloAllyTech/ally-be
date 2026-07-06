import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PromptsRepository } from '../repository/prompt.repository';
import {
  PromptSearchOptions,
  PromptsWithPromptCode,
} from '../type/prompt-response.type';

const PROMPTS_DIR = 'src/prompts';

@Injectable()
export class PromptSharedService {
  constructor(private readonly promptsRepository: PromptsRepository) {}

  /**
   * Get the current prompt content by standardized prompt code.
   * - When useDashboardOverride is false: read from folder (src/prompts/{promptCode}.txt)
   * - When useDashboardOverride is true: read from DB (prompts_versions)
   * Returns null if not found.
   */
  async getPromptByCode(promptCode: string): Promise<string | null> {
    const promptRow = await this.promptsRepository.findOne({
      where: { promptCode },
      select: ['id', 'useDashboardOverride'],
    });

    if (!promptRow) {
      return await this.readFromFolder(promptCode);
    }

    if (!promptRow.useDashboardOverride) {
      const fromFolder = await this.readFromFolder(promptCode);
      if (fromFolder !== null) {
        return fromFolder;
      }
      // Fallback: check if DB prompt row has defaultPrompt
      const fullRow = await this.promptsRepository.findOne({
        where: { promptCode },
        select: ['defaultPrompt'],
      });
      return fullRow?.defaultPrompt || null;
    }

    const row = (await this.promptsRepository
      .createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .addSelect('pv.prompt', 'prompt')
      .where('prompt.promptCode = :promptCode', { promptCode })
      .getRawOne()) as { prompt?: string } | undefined;

    return row?.prompt ?? null;
  }

  /**
   * Resolve promptCode to file path. Supports:
   * - Flat: promptCode.txt (legacy)
   * - Subdir: subdir/rest.txt when promptCode = subdir_rest (e.g. openai_simulation_foo -> openai_simulation/foo.txt)
   */
  private async readFromFolder(promptCode: string): Promise<string | null> {
    const promptsDir = path.join(process.cwd(), PROMPTS_DIR);
    try {
      try {
        await fs.promises.stat(promptsDir);
      } catch {
        return null;
      }

      // Try flat first (backward compat)
      const flatPath = path.join(promptsDir, `${promptCode}.txt`);
      try {
        await fs.promises.stat(flatPath);
        const content = await fs.promises.readFile(flatPath, 'utf-8');
        return content.trim();
      } catch {
        // Flat file not found, try subdir
      }

      // Try subdirs: promptCode subdir_rest -> subdir/rest.txt
      const entries = await fs.promises.readdir(promptsDir, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const prefix = entry.name.replace(/-/g, '_');
        if (promptCode.startsWith(prefix + '_')) {
          const rest = promptCode.slice(prefix.length + 1);
          const subdirPath = path.join(promptsDir, entry.name, `${rest}.txt`);
          try {
            await fs.promises.stat(subdirPath);
            const content = await fs.promises.readFile(subdirPath, 'utf-8');
            return content.trim();
          } catch {
            // Subdir file not found
          }
        }
      }
    } catch {
      // Ignore read errors
    }
    return null;
  }

  /**
   * Get prompts by options.
   * Returns an array of prompts with prompt code.
   *
   * @param options - The options to filter prompts by.
   * example options: { promptCode: ['ally_ai_learn_default']}
   * @returns An array of prompts with prompt code.
   */
  /**
   * Prompt-level LLM override for a single prompt code: `{ model, temperature }`
   * read from the prompts row. Both undefined when unset or the prompt has no
   * row. Used by ally-be's own LLM call sites (coaching chat, tooltip
   * translation, autofill, copilot) to honor a per-prompt model/temperature.
   */
  async getPromptLlmConfig(
    promptCode: string,
  ): Promise<{ provider?: string; model?: string; temperature?: number }> {
    const rows = await this.getPromptsByOptions({ promptCode: [promptCode] });
    const row = rows?.[0];
    return {
      provider: row?.provider || undefined,
      model: row?.model || undefined,
      temperature: typeof row?.temperature === 'number' ? row.temperature : undefined,
    };
  }

  async getPromptsByOptions(
    options: PromptSearchOptions,
  ): Promise<Array<PromptsWithPromptCode>> {
    const query = this.promptsRepository
      .createQueryBuilder('prompt')
      .leftJoin(
        'prompts_versions',
        'pv',
        '"prompt"."id" = "pv"."promptId" AND "pv"."version" = "prompt"."currentVersion"',
      )
      .select(['pv.prompt AS prompt', 'prompt.promptCode AS "promptCode"'])
      .addSelect('prompt.useDashboardOverride', 'useDashboardOverride')
      .addSelect('prompt.availableVariables', 'availableVariables')
      .addSelect('prompt.hasStates', 'hasStates')
      .addSelect('prompt.provider', 'provider')
      .addSelect('prompt.model', 'model')
      .addSelect('prompt.temperature', 'temperature')
      .addSelect('prompt.defaultPrompt', 'defaultPrompt')
      .addSelect('prompt.currentVersion', 'currentVersion');

    if (options.promptCode && options.promptCode.length > 0) {
      query.andWhere('prompt.promptCode IN (:...promptCodes)', {
        promptCodes: options.promptCode,
      });
    }
    if (options.promptCodePrefix) {
      query.andWhere('prompt.promptCode LIKE :prefix', {
        prefix: `${options.promptCodePrefix}%`,
      });
    }
    if (options.useDashboardOverrideOnly === true) {
      query.andWhere('prompt.useDashboardOverride = true');
    }

    const rows = await query.getRawMany<
      PromptsWithPromptCode & {
        useDashboardOverride: boolean;
        availableVariables?: (
          | string
          | { name: string; label?: string; required?: boolean }
        )[];
        hasStates?: boolean;
        defaultPrompt?: string;
        currentVersion?: number;
      }
    >();

    for (const row of rows) {
      // Raw query returns the numeric `temperature` column as a string; coerce
      // to a number so the runtime payload carries a real number (or undefined).
      const rawTemp = row.temperature as unknown;
      row.temperature =
        rawTemp === null || rawTemp === undefined || rawTemp === ''
          ? undefined
          : parseFloat(rawTemp as string);
      if (!row.useDashboardOverride) {
        const fromFolder = await this.readFromFolder(row.promptCode);
        if (fromFolder !== null) {
          row.prompt = fromFolder;
        } else if (row.defaultPrompt) {
          row.prompt = row.defaultPrompt;
        }
      } else if (!row.prompt?.trim() && row.defaultPrompt?.trim()) {
        // Dashboard override enabled but version join returned null (e.g. currentVersion not set); use default
        row.prompt = row.defaultPrompt;
      }
    }

    return rows;
  }
}
