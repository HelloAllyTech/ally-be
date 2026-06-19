import { Injectable } from '@nestjs/common';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { CopilotRun } from '../entity/copilot-run.entity';
import { CopilotRunStatus } from '../enum/copilot-run.enum';
import { COPILOT_END_STATUSES } from '../constants/copilot.constant';
import { TIME } from 'src/common/constants/time.constants';

@Injectable()
export class CopilotRunRepository extends Repository<CopilotRun> {
  constructor(private readonly dataSource: DataSource) {
    super(CopilotRun, dataSource.createEntityManager());
  }

  /** Find the active run whose current round is being evaluated by this report. */
  async findActiveByReportId(reportId: string): Promise<CopilotRun | null> {
    return this.findOne({ where: { currentReportId: reportId } });
  }

  /** Runs stuck in a non-terminal status past the timeout (watchdog sweep). */
  async findStaleRuns(timeoutMinutes: number): Promise<CopilotRun[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * TIME.MINUTE_IN_MS);
    return this.find({
      where: {
        status: In([
          CopilotRunStatus.STARTED,
          CopilotRunStatus.GENERATING,
          CopilotRunStatus.EVALUATING,
          CopilotRunStatus.REFINING,
        ]),
        updatedAt: LessThan(cutoff),
      },
    });
  }

  isEndStatus(status: CopilotRunStatus): boolean {
    return COPILOT_END_STATUSES.includes(status);
  }
}
