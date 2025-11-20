import { DataSource, Repository } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { ScenarioPathSessionItem } from '../entity/scenario-path-session-item.entity';

@Injectable()
export class ScenarioPathSessionItemRepository extends Repository<ScenarioPathSessionItem> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioPathSessionItem, dataSource.createEntityManager());
  }
}
