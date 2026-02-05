import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioCharacter } from '../entity/scenario-character.entity';
import { ScenarioCharacterGetOptions as ScenarioCharacterGetOptions } from '../type/scenario-character.type';
import { ScenarioCharacterSortBy } from '../enum/scenario-character.enum';
import { ScenarioCharacterSortOrder } from '../enum/scenario-character.enum';

@Injectable()
export class ScenarioCharacterRepository extends Repository<ScenarioCharacter> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioCharacter, dataSource.createEntityManager());
  }

  async getScenarioCharactersQuery(
    options: ScenarioCharacterGetOptions = {},
  ): Promise<{ characters: ScenarioCharacter[]; count: number }> {
    const {
      search,
      limit = 15,
      offset = 0,
      sortBy = ScenarioCharacterSortBy.NAME,
      sortOrder = ScenarioCharacterSortOrder.ASC,
    } = options;

    const sortColumn = Object.values(ScenarioCharacterSortBy).includes(
      sortBy as ScenarioCharacterSortBy,
    )
      ? sortBy
      : ScenarioCharacterSortBy.NAME;

    const query = this.createQueryBuilder('scenarioCharacter')
      .orderBy(`scenarioCharacter.${sortColumn}`, sortOrder)
      .limit(limit)
      .offset(offset);

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
