import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabVariable } from '../entity/lab-variable.entity';

@Injectable()
export class LabVariableRepository extends Repository<LabVariable> {
  constructor(private readonly dataSource: DataSource) {
    super(LabVariable, dataSource.createEntityManager());
  }

  async list(options: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: LabVariable[]; count: number }> {
    const { search, limit = 100, offset = 0 } = options;
    const query = this.createQueryBuilder('variable')
      .orderBy('variable.name', 'ASC')
      .limit(limit)
      .offset(offset);

    if (search) {
      query.andWhere(
        '(variable.name ILIKE :search OR variable.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [items, count] = await query.getManyAndCount();
    return { items, count };
  }
}
