import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { CaseSessionItem } from '../entity/case-session-item.entity';

@Injectable()
export class CaseSessionItemRepository extends Repository<CaseSessionItem> {
  constructor(private readonly dataSource: DataSource) {
    super(CaseSessionItem, dataSource.createEntityManager());
  }
}
