import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { BugHunterFeatureMap } from '../entity/bug-hunter-feature-map.entity';

@Injectable()
export class BugHunterFeatureMapRepository extends Repository<BugHunterFeatureMap> {
  constructor(dataSource: DataSource) {
    super(BugHunterFeatureMap, dataSource.createEntityManager());
  }
}
