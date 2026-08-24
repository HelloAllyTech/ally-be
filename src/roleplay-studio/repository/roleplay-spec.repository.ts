import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoleplaySpec } from '../entity/roleplay-spec.entity';

@Injectable()
export class RoleplaySpecRepository extends Repository<RoleplaySpec> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplaySpec, dataSource.createEntityManager());
  }

  async findAndCountSpecs(options: {
    createdBy?: number;
    statuses?: string[];
    limit?: number;
    offset?: number;
  }): Promise<[RoleplaySpec[], number]> {
    const qb = this.createQueryBuilder('spec');
    if (options.createdBy !== undefined) {
      qb.andWhere('spec.createdBy = :createdBy', {
        createdBy: options.createdBy,
      });
    }
    if (options.statuses && options.statuses.length > 0) {
      qb.andWhere('spec.status IN (:...statuses)', {
        statuses: options.statuses,
      });
    }
    if (options.limit) {
      qb.limit(options.limit);
    }
    if (options.offset) {
      qb.offset(options.offset);
    }
    qb.orderBy('spec.updatedAt', 'DESC');
    return qb.getManyAndCount();
  }

  // Soft-deleted specs are excluded automatically (query builder filters on
  // deletedAt IS NULL for entities with a @DeleteDateColumn).
  async existsWithCompetencyId(competencyId: string): Promise<boolean> {
    const count = await this.createQueryBuilder('spec')
      .where('spec.competencyId = :competencyId', { competencyId })
      .orWhere('spec.competencyIds @> :competencyIdJson', {
        competencyIdJson: JSON.stringify([competencyId]),
      })
      .getCount();
    return count > 0;
  }
}
