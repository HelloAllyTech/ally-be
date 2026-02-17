import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioBehaviorInstruction } from '../entity/scenario-behavior-instruction.entity';

@Injectable()
export class ScenarioBehaviorInstructionRepository extends Repository<ScenarioBehaviorInstruction> {
  constructor(private dataSource: DataSource) {
    super(ScenarioBehaviorInstruction, dataSource.createEntityManager());
  }

  async getByScenarioId(
    scenarioId: number,
  ): Promise<ScenarioBehaviorInstruction[]> {
    return this.find({
      where: {
        scenarioId,
      },
    });
  }
}
