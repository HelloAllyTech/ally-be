import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BadgeTenant } from '../entity/badge-tenant.entity';

@Injectable()
export class BadgeTenantRepository extends Repository<BadgeTenant> {
  constructor(private dataSource: DataSource) {
    super(BadgeTenant, dataSource.createEntityManager());
  }
}
