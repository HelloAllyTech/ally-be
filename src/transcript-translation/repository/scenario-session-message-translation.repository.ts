import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { ScenarioSessionMessageTranslation } from '../entity/scenario-session-message-translation.entity';

@Injectable()
export class ScenarioSessionMessageTranslationRepository extends Repository<ScenarioSessionMessageTranslation> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionMessageTranslation, dataSource.createEntityManager());
  }

  findByMessageIdsAndLanguageId(
    scenarioSessionMessageIds: number[],
    languageId: number,
  ): Promise<ScenarioSessionMessageTranslation[]> {
    if (!scenarioSessionMessageIds.length) {
      return Promise.resolve([]);
    }
    return this.find({
      where: {
        scenarioSessionMessageId: In(scenarioSessionMessageIds),
        languageId,
      },
    });
  }

  findOneByMessageIdAndLanguageId(
    scenarioSessionMessageId: number,
    languageId: number,
  ): Promise<ScenarioSessionMessageTranslation | null> {
    return this.findOne({
      where: { scenarioSessionMessageId, languageId },
    });
  }

  async upsertOne(row: {
    scenarioSessionMessageId: number;
    languageId: number;
    content: string;
  }): Promise<ScenarioSessionMessageTranslation> {
    await this.createQueryBuilder()
      .insert()
      .into(ScenarioSessionMessageTranslation)
      .values(row)
      .orIgnore()
      .execute();

    const saved = await this.findOneByMessageIdAndLanguageId(
      row.scenarioSessionMessageId,
      row.languageId,
    );
    return saved as ScenarioSessionMessageTranslation;
  }
}
