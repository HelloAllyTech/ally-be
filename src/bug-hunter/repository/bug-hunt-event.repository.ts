import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';

@Injectable()
export class BugHuntEventRepository extends Repository<BugHuntEvent> {
  constructor(dataSource: DataSource) {
    super(BugHuntEvent, dataSource.createEntityManager());
  }

  /** Full timeline for one run, in the order it happened. */
  listForRun(runId: string): Promise<BugHuntEvent[]> {
    return this.find({ where: { runId }, order: { createdAt: 'ASC' } });
  }

  /** Every event reported about one specific finding, across however many runs touched it — the drawer's timeline. */
  listForFinding(findingId: string): Promise<BugHuntEvent[]> {
    return this.find({ where: { findingId }, order: { createdAt: 'ASC' } });
  }

  /**
   * New events since a given row, for the SSE stream's poll loop — see
   * BugHunterController.streamRun. `createdAt` alone can tie under load, so
   * the stream also excludes `afterId` itself when timestamps match.
   */
  listSince(runId: string, afterCreatedAt: Date): Promise<BugHuntEvent[]> {
    return this.find({
      where: { runId, createdAt: MoreThan(afterCreatedAt) },
      order: { createdAt: 'ASC' },
    });
  }
}
