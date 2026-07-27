import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import {
  PromptTranslation,
  PromptTranslationStatus,
} from '../entity/prompt-translation.entity';
import { Prompt } from '../entity/prompt.entity';

/** One row per requested prompt code (translation columns null when absent). */
export interface RuntimeTranslationRow {
  promptCode: string;
  promptId: string;
  translationEnabled: boolean;
  promptType: string | null;
  translatedPrompt: string | null;
  sourceHash: string | null;
  status: PromptTranslationStatus | null;
  runtimeProvider: string | null;
  runtimeModel: string | null;
}

@Injectable()
export class PromptTranslationRepository extends Repository<PromptTranslation> {
  constructor(private dataSource: DataSource) {
    super(PromptTranslation, dataSource.createEntityManager());
  }

  /**
   * For a set of prompt codes + one language, return each prompt with its
   * translation state (LEFT JOIN, so a code with no translation still returns a
   * row carrying `translationEnabled`/`promptType` for gating + self-heal).
   */
  async getRuntimeRows(
    promptCodes: string[],
    languageId: number,
  ): Promise<RuntimeTranslationRow[]> {
    if (!promptCodes.length) return [];
    return this.manager
      .createQueryBuilder(Prompt, 'p')
      .leftJoin(
        PromptTranslation,
        'pt',
        'pt."promptId" = p.id AND pt."languageId" = :languageId',
        { languageId },
      )
      .where('p."promptCode" IN (:...promptCodes)', { promptCodes })
      .select('p."promptCode"', 'promptCode')
      .addSelect('p.id', 'promptId')
      .addSelect('p."translationEnabled"', 'translationEnabled')
      .addSelect('p."promptType"', 'promptType')
      .addSelect('pt."translatedPrompt"', 'translatedPrompt')
      .addSelect('pt."sourceHash"', 'sourceHash')
      .addSelect('pt.status', 'status')
      .addSelect('pt."runtimeProvider"', 'runtimeProvider')
      .addSelect('pt."runtimeModel"', 'runtimeModel')
      .getRawMany<RuntimeTranslationRow>();
  }

  findByPromptAndLanguage(
    promptId: string,
    languageId: number,
  ): Promise<PromptTranslation | null> {
    return this.findOne({ where: { promptId, languageId } });
  }

  findAllForPrompt(promptId: string): Promise<PromptTranslation[]> {
    return this.find({ where: { promptId }, order: { languageId: 'ASC' } });
  }

  /**
   * Insert or update the single live row for (promptId, languageId). Only the
   * provided fields are written; `promptId`/`languageId` form the conflict key.
   */
  async upsertTranslation(
    input: Partial<PromptTranslation> &
      Pick<
        PromptTranslation,
        'promptId' | 'languageId' | 'sourceHash' | 'status'
      >,
  ): Promise<void> {
    await this.upsert(input, {
      conflictPaths: ['promptId', 'languageId'],
      skipUpdateIfNoValuesChanged: true,
    });
  }

  async markStatus(
    promptId: string,
    languageId: number,
    status: PromptTranslationStatus,
    error?: string,
  ): Promise<void> {
    await this.update({ promptId, languageId }, { status, error });
  }

  /**
   * Set (or clear, with null) the runtime provider/model for one (prompt,
   * language) — the model that runs the main agent when this translated body is
   * served. No-op when the row doesn't exist yet (nothing translated).
   */
  async setRuntimeModel(
    promptId: string,
    languageId: number,
    runtimeProvider: string | null,
    runtimeModel: string | null,
  ): Promise<void> {
    // null clears the override (back to the prompt's own model); TypeORM skips
    // `undefined` but writes `null`, so cast to allow the null write.
    await this.update({ promptId, languageId }, {
      runtimeProvider,
      runtimeModel,
    } as unknown as Partial<PromptTranslation>);
  }
}
