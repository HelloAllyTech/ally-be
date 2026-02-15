import { Injectable } from '@nestjs/common';
import { PromptsRepository } from '../repository/prompt.repository';

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
}
