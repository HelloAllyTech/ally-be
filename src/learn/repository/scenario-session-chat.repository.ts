import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionChat } from '../entity/scenario-session-chat.entity';

@Injectable()
export class ScenarioSessionChatRepository extends Repository<ScenarioSessionChat> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionChat, dataSource.createEntityManager());
  }
}
