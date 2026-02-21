import { Injectable } from '@nestjs/common';
import { PromptsRepository } from '../repository/prompt.repository';
import {
  PromptSearchOptions,
  PromptsWithPromptCode,
} from '../type/prompt-response.type';

@Injectable()
export class PromptSharedService {
  constructor(private readonly promptsRepository: PromptsRepository) {}

  /**
   * Get the current prompt content by standardized prompt code.
   * Returns null if not found or current version is not set.
   */
  async getPromptByCode(promptCode: string): Promise<string | null> {
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
   * Get prompts by options.
   * Returns an array of prompts with prompt code.
   *
   * @param options - The options to filter prompts by.
   * example options: { useCase: ['scenario_session']}
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
      .select(['pv.prompt AS prompt', 'prompt.promptCode AS "promptCode"']);

    if (options.useCase && options.useCase.length > 0) {
      query.andWhere('prompt.useCase IN (:...useCases)', {
        useCases: options.useCase,
      });
    }

    if (options.promptCode && options.promptCode.length > 0) {
      query.andWhere('prompt.promptCode IN (:...promptCodes)', {
        promptCodes: options.promptCode,
      });
    }

    return query.getRawMany<PromptsWithPromptCode>();
  }
}
