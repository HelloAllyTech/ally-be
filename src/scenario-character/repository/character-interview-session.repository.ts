import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CharacterInterviewSession } from '../entity/character-interview-session.entity';

@Injectable()
export class CharacterInterviewSessionRepository extends Repository<CharacterInterviewSession> {
  constructor(private readonly dataSource: DataSource) {
    super(CharacterInterviewSession, dataSource.createEntityManager());
  }
}
