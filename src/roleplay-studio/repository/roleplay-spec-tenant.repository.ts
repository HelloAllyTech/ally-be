import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoleplaySpecTenant } from '../entity/roleplay-spec-tenant.entity';

@Injectable()
export class RoleplaySpecTenantRepository extends Repository<RoleplaySpecTenant> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplaySpecTenant, dataSource.createEntityManager());
  }

  listBySpec(specId: string): Promise<RoleplaySpecTenant[]> {
    return this.find({ where: { specId }, order: { createdAt: 'ASC' } });
  }
}
