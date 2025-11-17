import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioPaths } from '../entity/scenario-paths.entity';

@Injectable()
export class ScenarioPathRepository extends Repository<ScenarioPaths> {
  constructor(private dataSource: DataSource) {
    super(ScenarioPaths, dataSource.createEntityManager());
  }
}
