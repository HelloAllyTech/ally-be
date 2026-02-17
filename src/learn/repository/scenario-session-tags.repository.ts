import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionTags } from '../entity/scenario-session-tags.entity';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ScenarioSessionTagsRepository extends Repository<ScenarioSessionTags> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionTags, dataSource.createEntityManager());
  }
}
