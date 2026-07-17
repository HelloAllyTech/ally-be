import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RoleplayDirectorEvent } from '../entity/roleplay-director-event.entity';

@Injectable()
export class RoleplayDirectorEventRepository extends Repository<RoleplayDirectorEvent> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplayDirectorEvent, dataSource.createEntityManager());
  }

  listBySession(scenarioSessionId: string): Promise<RoleplayDirectorEvent[]> {
    return this.find({
      where: { scenarioSessionId },
      order: { createdAt: 'ASC' },
    });
  }
}
