import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { ScenarioTranslations } from '../entity/scenario-translation.entity';
import { SuccessResponse } from 'src/common/type/common.type';
import {
  CreateScenarioTranslation,
  UpdateScenarioTranslation,
} from '../interface/scenario-translation.interface';

@Injectable()
export class ScenarioTranslationsRepository extends Repository<ScenarioTranslations> {
  constructor(private dataSource: DataSource) {
    super(ScenarioTranslations, dataSource.createEntityManager());
  }

  // Every method takes an optional EntityManager so a caller that is already
  // inside a transaction (scenario publish) can keep its reads and writes on
  // that connection instead of the pool.
  async getScenarioTranslationsByScenarioId(
    scenarioId: number,
    manager?: EntityManager,
  ): Promise<ScenarioTranslations[] | null> {
    const repo = manager ? manager.getRepository(ScenarioTranslations) : this;
    return await repo.find({
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
    scenarioTranslations: Array<CreateScenarioTranslation>, // Changed string to number
    manager?: EntityManager,
  ): Promise<SuccessResponse> {
    const repo = manager ? manager.getRepository(ScenarioTranslations) : this;
    await repo.save(repo.create(scenarioTranslations));
    return {
      success: true,
    };
  }

  async updateScenarioTranslations(
    scenarioTranslations: Array<UpdateScenarioTranslation>,
    manager?: EntityManager,
  ): Promise<SuccessResponse> {
    const run = async (transactionalEntityManager: EntityManager) => {
      for (const translation of scenarioTranslations) {
        const { scenarioId, languageId, metadata } = translation;
        await transactionalEntityManager.update(
          ScenarioTranslations,
          { scenarioId, languageId }, // Selection criteria
          { metadata }, // Fields to update
        );
      }
    };
    // Inside a caller's transaction: reuse it. Otherwise open one so all
    // updates succeed or fail together.
    if (manager) {
      await run(manager);
    } else {
      await this.dataSource.transaction(run);
    }

    return {
      success: true,
    };
  }
}
