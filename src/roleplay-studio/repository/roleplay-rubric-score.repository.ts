import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoleplayRubricScore } from '../entity/roleplay-rubric-score.entity';

@Injectable()
export class RoleplayRubricScoreRepository extends Repository<RoleplayRubricScore> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplayRubricScore, dataSource.createEntityManager());
  }

  listBySession(scenarioSessionId: string): Promise<RoleplayRubricScore[]> {
    return this.find({
      where: { scenarioSessionId },
      order: { turnIndex: 'ASC', createdAt: 'ASC' },
    });
  }
}
