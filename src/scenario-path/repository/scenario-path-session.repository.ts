import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioPathSession } from '../entity/scenario-path-session.entity';

@Injectable()
export class ScenarioPathSessionRepository extends Repository<ScenarioPathSession> {
  constructor(private readonly dataSource: DataSource) {
    super(ScenarioPathSession, dataSource.createEntityManager());
  }
}
