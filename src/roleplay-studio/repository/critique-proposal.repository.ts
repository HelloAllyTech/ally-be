import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CritiqueProposal } from '../entity/critique-proposal.entity';

@Injectable()
export class CritiqueProposalRepository extends Repository<CritiqueProposal> {
  constructor(private readonly dataSource: DataSource) {
    super(CritiqueProposal, dataSource.createEntityManager());
  }

  listByRehearsal(rehearsalRunId: string): Promise<CritiqueProposal[]> {
    return this.find({
      where: { rehearsalRunId },
      order: { createdAt: 'ASC' },
    });
  }

  listByImprovementRun(improvementRunId: string): Promise<CritiqueProposal[]> {
    return this.find({
      where: { improvementRunId },
      order: { roundNumber: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Every proposal ever made against any version of a spec (joined through
   * rehearsal_runs), oldest first — the critique prompt's proposal history
   * and the orchestrator's oscillation guard both read this.
   */
  historyForSpec(specId: string): Promise<CritiqueProposal[]> {
    return this.createQueryBuilder('proposal')
      .innerJoin(
        'rehearsal_runs',
        'run',
        'run.id = proposal."rehearsalRunId" AND run."specId" = :specId',
        { specId },
      )
      .orderBy('proposal.createdAt', 'ASC')
      .getMany();
  }
}
