import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CaseSession } from '../entity/case-session.entity';

@Injectable()
export class CaseSessionRepository extends Repository<CaseSession> {
  constructor(private readonly dataSource: DataSource) {
    super(CaseSession, dataSource.createEntityManager());
  }
}
