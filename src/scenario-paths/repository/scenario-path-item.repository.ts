import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioPathItems } from '../entity/scenario-path-items.entity';

@Injectable()
export class ScenarioPathItemRepository extends Repository<ScenarioPathItems> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioPathItems, dataSource.createEntityManager());
  }
}
