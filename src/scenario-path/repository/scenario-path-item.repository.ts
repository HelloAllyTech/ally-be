import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioPathItem } from '../entity/scenario-path-item.entity';

@Injectable()
export class ScenarioPathItemRepository extends Repository<ScenarioPathItem> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioPathItem, dataSource.createEntityManager());
  }
}
