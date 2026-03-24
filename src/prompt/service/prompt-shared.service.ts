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
      return this.readFromFolder(promptCode);
    }

    if (!promptRow.useDashboardOverride) {
      const fromFolder = this.readFromFolder(promptCode);
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
  private readFromFolder(promptCode: string): string | null {
    const promptsDir = path.join(process.cwd(), PROMPTS_DIR);
    try {
      if (!fs.existsSync(promptsDir)) return null;

      // Try flat first (backward compat)
      const flatPath = path.join(promptsDir, `${promptCode}.txt`);
      if (fs.existsSync(flatPath)) {
        return fs.readFileSync(flatPath, 'utf-8').trim();
      }

      // Try subdirs: promptCode subdir_rest -> subdir/rest.txt
      const entries = fs.readdirSync(promptsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const prefix = entry.name.replace(/-/g, '_');
        if (promptCode.startsWith(prefix + '_')) {
          const rest = promptCode.slice(prefix.length + 1);
          const subdirPath = path.join(promptsDir, entry.name, `${rest}.txt`);
          if (fs.existsSync(subdirPath)) {
            return fs.readFileSync(subdirPath, 'utf-8').trim();
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
      .addSelect('prompt.defaultPrompt', 'defaultPrompt');

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
        defaultPrompt?: string;
      }
    >();

    for (const row of rows) {
      if (!row.useDashboardOverride) {
        const fromFolder = this.readFromFolder(row.promptCode);
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
