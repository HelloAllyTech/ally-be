import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RehearsalTranscript } from '../entity/rehearsal-transcript.entity';

@Injectable()
export class RehearsalTranscriptRepository extends Repository<RehearsalTranscript> {
  constructor(private readonly dataSource: DataSource) {
    super(RehearsalTranscript, dataSource.createEntityManager());
  }

  listByRun(rehearsalRunId: string): Promise<RehearsalTranscript[]> {
    return this.find({
      where: { rehearsalRunId },
      order: { createdAt: 'ASC' },
    });
  }
}
