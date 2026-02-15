import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionDetails } from '../entity/scenario-session-details.entity';
import { Injectable } from '@nestjs/common';
@Injectable()
export class ScenarioSessionDetailsRepository extends Repository<ScenarioSessionDetails> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionDetails, dataSource.createEntityManager());
  }
}
