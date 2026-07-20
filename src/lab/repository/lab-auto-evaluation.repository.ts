import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { LabAutoEvaluation } from '../entity/lab-auto-evaluation.entity';

@Injectable()
export class LabAutoEvaluationRepository extends Repository<LabAutoEvaluation> {
  constructor(private readonly dataSource: DataSource) {
    super(LabAutoEvaluation, dataSource.createEntityManager());
  }

  /** Auto-evaluations for a run, newest first. */
  async listForRun(runId: string): Promise<LabAutoEvaluation[]> {
    return this.find({ where: { runId }, order: { createdAt: 'DESC' } });
  }
}
