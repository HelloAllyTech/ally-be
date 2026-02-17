import { Injectable } from '@nestjs/common';
import { DataSource, Repository, In } from 'typeorm';
import { ScenarioBehaviorInstructionBehavior } from '../entity/scenario-behavior-instruction-behavior.entity';

@Injectable()
export class ScenarioBehaviorInstructionBehaviorRepository extends Repository<ScenarioBehaviorInstructionBehavior> {
  constructor(private dataSource: DataSource) {
    super(
      ScenarioBehaviorInstructionBehavior,
      dataSource.createEntityManager(),
    );
  }

  async getByInstructionIds(
    instructionIds: string[],
  ): Promise<ScenarioBehaviorInstructionBehavior[]> {
    if (instructionIds.length === 0) {
      return [];
    }
    return this.find({
      where: {
        scenarioBehaviorInstructionId: In(instructionIds),
      },
    });
  }
}
