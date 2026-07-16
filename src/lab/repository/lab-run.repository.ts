import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabRun } from '../entity/lab-run.entity';

@Injectable()
export class LabRunRepository extends Repository<LabRun> {
  constructor(private readonly dataSource: DataSource) {
    super(LabRun, dataSource.createEntityManager());
  }

  async list(options: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: LabRun[]; count: number }> {
    const { search, limit = 100, offset = 0 } = options;
    const query = this.createQueryBuilder('run')
      .orderBy('run.createdAt', 'DESC')
      .limit(limit)
      .offset(offset);

    if (search) {
      query.andWhere(
        '(run.skillName ILIKE :search OR run.output ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [items, count] = await query.getManyAndCount();
    return { items, count };
  }
}
