import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabSkill } from '../entity/lab-skill.entity';

@Injectable()
export class LabSkillRepository extends Repository<LabSkill> {
  constructor(private readonly dataSource: DataSource) {
    super(LabSkill, dataSource.createEntityManager());
  }

  async list(options: {
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: LabSkill[]; count: number }> {
    const { search, limit = 100, offset = 0 } = options;
    const query = this.createQueryBuilder('skill')
      .orderBy('skill.updatedAt', 'DESC')
      .limit(limit)
      .offset(offset);

    if (search) {
      query.andWhere(
        '(skill.name ILIKE :search OR skill.description ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    const [items, count] = await query.getManyAndCount();
    return { items, count };
  }
}
