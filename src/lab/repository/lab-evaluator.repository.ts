import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabEvaluator } from '../entity/lab-evaluator.entity';

@Injectable()
export class LabEvaluatorRepository extends Repository<LabEvaluator> {
  constructor(private readonly dataSource: DataSource) {
    super(LabEvaluator, dataSource.createEntityManager());
  }

  async list(options: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: LabEvaluator[]; count: number }> {
    const { search, limit = 100, offset = 0 } = options;
    const query = this.createQueryBuilder('evaluator')
      .orderBy('evaluator.createdAt', 'DESC')
      .limit(limit)
      .offset(offset);

    if (search) {
      query.andWhere('evaluator.email ILIKE :search', {
        search: `%${search}%`,
      });
    }

    const [items, count] = await query.getManyAndCount();
    return { items, count };
  }
}
