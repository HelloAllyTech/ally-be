import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CaseItem } from '../entity/case-item.entity';

@Injectable()
export class CaseItemRepository extends Repository<CaseItem> {
  constructor(private readonly dataSource: DataSource) {
    super(CaseItem, dataSource.createEntityManager());
  }
}
