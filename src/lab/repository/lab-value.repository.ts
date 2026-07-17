import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabValue } from '../entity/lab-value.entity';

@Injectable()
export class LabValueRepository extends Repository<LabValue> {
  constructor(private readonly dataSource: DataSource) {
    super(LabValue, dataSource.createEntityManager());
  }

  async list(options: {
    search?: string;
    variableId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: LabValue[]; count: number }> {
    const { search, variableId, limit = 100, offset = 0 } = options;
    const query = this.createQueryBuilder('value')
      // Join the parent variable so callers can render the variable name
      // alongside each value without a second round-trip.
      .leftJoinAndSelect('value.variable', 'variable')
      .orderBy('value.updatedAt', 'DESC')
      .limit(limit)
      .offset(offset);

    if (variableId) {
      query.andWhere('value.variableId = :variableId', { variableId });
    }

    if (search) {
      query.andWhere(
        '(value.value ILIKE :search OR value.label ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [items, count] = await query.getManyAndCount();
    return { items, count };
  }
}
