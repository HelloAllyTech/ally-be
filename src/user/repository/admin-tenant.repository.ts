import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { AdminTenant } from '../entity/admin-tenant.entity';

@Injectable()
export class AdminTenantRepository extends Repository<AdminTenant> {
  constructor(private dataSource: DataSource) {
    super(AdminTenant, dataSource.createEntityManager());
  }
}
