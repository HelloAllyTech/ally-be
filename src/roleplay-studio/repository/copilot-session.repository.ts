import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CopilotSession } from '../entity/copilot-session.entity';

@Injectable()
export class CopilotSessionRepository extends Repository<CopilotSession> {
  constructor(private readonly dataSource: DataSource) {
    super(CopilotSession, dataSource.createEntityManager());
  }
}
