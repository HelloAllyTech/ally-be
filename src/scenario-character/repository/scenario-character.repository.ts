import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioCharacter } from '../entity/scenario-character.entity';
import { ScenarioCharacterGetOptions as ScenarioCharacterGetOptions } from '../type/scenario-character.type';

@Injectable()
export class ScenarioCharacterRepository extends Repository<ScenarioCharacter> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioCharacter, dataSource.createEntityManager());
  }

  async getScenarioCharactersQuery(
    options: ScenarioCharacterGetOptions = {},
  ): Promise<{ characters: ScenarioCharacter[]; count: number }> {
    const { search, limit, offset, sortBy, sortOrder } = options;

    const query = this.createQueryBuilder('scenarioCharacter')
      .orderBy(`scenarioCharacter.${sortBy}`, sortOrder)
      .limit(Number(limit))
      .offset(Number(offset));

    if (search?.trim()) {
      const term = `%${search.trim()}%`;
      query.andWhere(
        '(scenarioCharacter.name ILIKE :term OR scenarioCharacter.profession ILIKE :term OR scenarioCharacter.current_location ILIKE :term)',
        { term },
      );
    }

    const [characters, count] = await query.getManyAndCount();
    return { characters, count };
  }
}
