import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { BehaviorTranslation } from '../entity/behavior-translation.entity';

@Injectable()
export class BehaviorTranslationRepository extends Repository<BehaviorTranslation> {
  constructor(private dataSource: DataSource) {
    super(BehaviorTranslation, dataSource.createEntityManager());
  }

  async getTranslationsByBehaviorId(
    behaviorId: string,
  ): Promise<BehaviorTranslation[]> {
    return this.find({ where: { behaviorId } });
  }

  async getTranslationsForBehaviors(
    behaviorIds: string[],
    languageId: number,
  ): Promise<BehaviorTranslation[]> {
    if (behaviorIds.length === 0) {
      return [];
    }
    return this.find({
      where: {
        behaviorId: In(behaviorIds),
        languageId,
      },
    });
  }
}
