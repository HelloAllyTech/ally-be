import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioEventsTranslation } from '../entity/scenario-events-translation.entity';
import { SuccessResponse } from 'src/common/type/common.type';
import {
  CreateScenarioEventsTranslation,
  UpdateScenarioEventsTranslation,
} from '../interface/scenario-events-translation.interface';

@Injectable()
export class ScenarioEventsTranslationsRepository extends Repository<ScenarioEventsTranslation> {
  constructor(private dataSource: DataSource) {
    super(ScenarioEventsTranslation, dataSource.createEntityManager());
  }

  async getScenarioEventsTranslationsByScenarioIdEventId(
    scenarioId: number,
    eventId: string,
  ): Promise<ScenarioEventsTranslation[]> {
    return await this.find({
      where: { scenarioId, eventId },
    });
  }

  async createTranslations(
    translations: CreateScenarioEventsTranslation[],
  ): Promise<SuccessResponse> {
    await this.save(this.create(translations));
    return { success: true };
  }

  async updateTranslations(
    translations: UpdateScenarioEventsTranslation[],
  ): Promise<SuccessResponse> {
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      for (const translation of translations) {
        const { scenarioId, eventId, languageId, message, branchInstruction } =
          translation;

        await transactionalEntityManager.update(
          ScenarioEventsTranslation,
          { scenarioId, eventId, languageId },
          {
            ...(message !== undefined && { message }),
            ...(branchInstruction !== undefined && { branchInstruction }),
          },
        );
      }
    });

    return { success: true };
  }
}
