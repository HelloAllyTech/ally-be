import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionChatMessage } from '../entity/scenario-session-chat-message.entity';

@Injectable()
export class ScenarioSessionChatMessageRepository extends Repository<ScenarioSessionChatMessage> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionChatMessage, dataSource.createEntityManager());
  }
}
