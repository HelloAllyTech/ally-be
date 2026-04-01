import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionRecording } from '../entity/scenario-session-recording.entity';

@Injectable()
export class ScenarioSessionRecordingRepository extends Repository<ScenarioSessionRecording> {
  constructor(private dataSource: DataSource) {
    super(ScenarioSessionRecording, dataSource.createEntityManager());
  }
}
