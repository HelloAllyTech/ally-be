import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabQuestionSet } from '../entity/lab-question-set.entity';
import { LabQuestionSetQuestion } from '../entity/lab-question-set-question.entity';

@Injectable()
export class LabQuestionSetRepository extends Repository<LabQuestionSet> {
  constructor(private readonly dataSource: DataSource) {
    super(LabQuestionSet, dataSource.createEntityManager());
  }

  async list(options: {
    search?: string;
    includeArchived?: boolean;
    publishedOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: LabQuestionSet[]; count: number }> {
    const {
      search,
      includeArchived = false,
      publishedOnly = false,
      limit = 100,
      offset = 0,
    } = options;
    const query = this.createQueryBuilder('set')
      .orderBy('set.updatedAt', 'DESC')
      .limit(limit)
      .offset(offset);

    if (search) {
      query.andWhere(
        '(set.name ILIKE :search OR set.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (!includeArchived) {
      query.andWhere('set.archivedAt IS NULL');
    }
    if (publishedOnly) {
      query.andWhere('set.publishedAt IS NOT NULL');
    }

    const [items, count] = await query.getManyAndCount();
    return { items, count };
  }
}

@Injectable()
export class LabQuestionSetQuestionRepository extends Repository<LabQuestionSetQuestion> {
  constructor(private readonly dataSource: DataSource) {
    super(LabQuestionSetQuestion, dataSource.createEntityManager());
  }
}
