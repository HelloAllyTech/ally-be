import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { ScenarioBehaviorInstructionTranslation } from '../entity/scenario-behavior-instruction-translation.entity';

@Injectable()
export class ScenarioBehaviorInstructionTranslationRepository extends Repository<ScenarioBehaviorInstructionTranslation> {
  constructor(private dataSource: DataSource) {
    super(
      ScenarioBehaviorInstructionTranslation,
      dataSource.createEntityManager(),
    );
  }

  async getTranslationsByInstructionId(
    instructionId: string,
  ): Promise<ScenarioBehaviorInstructionTranslation[]> {
    return this.find({
      where: { scenarioBehaviorInstructionId: instructionId },
    });
  }

  async deleteByInstructionIds(instructionIds: string[]): Promise<void> {
    if (instructionIds.length === 0) {
      return;
    }
    await this.delete({
      scenarioBehaviorInstructionId: In(instructionIds),
    });
  }

  async getTranslationsForInstructions(
    instructionIds: string[],
    languageId: number,
  ): Promise<ScenarioBehaviorInstructionTranslation[]> {
    if (instructionIds.length === 0) {
      return [];
    }
    return this.find({
      where: {
        scenarioBehaviorInstructionId: In(instructionIds),
        languageId,
      },
    });
  }
}
