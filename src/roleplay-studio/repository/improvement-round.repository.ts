import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ImprovementRound } from '../entity/improvement-round.entity';

@Injectable()
export class ImprovementRoundRepository extends Repository<ImprovementRound> {
  constructor(private readonly dataSource: DataSource) {
    super(ImprovementRound, dataSource.createEntityManager());
  }

  listByRun(improvementRunId: string): Promise<ImprovementRound[]> {
    return this.find({
      where: { improvementRunId },
      order: { roundNumber: 'ASC' },
    });
  }

  findByRehearsalRunId(
    rehearsalRunId: string,
  ): Promise<ImprovementRound | null> {
    return this.findOne({ where: { rehearsalRunId } });
  }
}
