import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioTranslations } from '../entity/scenario-translation.entity';
import { SuccessResponse } from 'src/common/type/common.type';

@Injectable()
export class ScenarioTranslationsRepository extends Repository<ScenarioTranslations> {
  constructor(private dataSource: DataSource) {
    super(ScenarioTranslations, dataSource.createEntityManager());
  }

  async getScenarioTranslationsByScenarioId(
    scenarioId: number,
  ): Promise<ScenarioTranslations[] | null> {
    return await this.find({
      where: { scenarioId },
    });
  }

  async getUniqueLanguagesFromScenarioTranslations(): Promise<number[]> {
    const rows = await this.createQueryBuilder('t')
      .select('DISTINCT t.languageId', 'languageId')
      .getRawMany();

    return rows.map((r) => Number(r.languageId));
  }

  async createScenarioTranslations(
    scenarioTranslations: Array<{
      scenarioId: number;
      languageId: number;
      metadata: any;
    }>, // Changed string to number
  ): Promise<SuccessResponse> {
    await this.save(this.create(scenarioTranslations));
    return {
      success: true,
    };
  }

  async updateScenarioTranslations(
    scenarioTranslations: Array<{
      scenarioId: number;
      languageId: number;
      metadata: any;
    }>,
  ): Promise<SuccessResponse> {
    // Use a transaction to ensure all updates succeed or fail together
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      for (const translation of scenarioTranslations) {
        const { scenarioId, languageId, metadata } = translation;
        await transactionalEntityManager.update(
          ScenarioTranslations,
          { scenarioId, languageId }, // Selection criteria
          { metadata }, // Fields to update
        );
      }
    });

    return {
      success: true,
    };
  }
}
