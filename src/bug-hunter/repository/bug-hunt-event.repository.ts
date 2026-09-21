import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { BugHuntEvent } from '../entity/bug-hunt-event.entity';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';

export interface EscalationBreakdown {
  summary: string;
  count: number;
}

@Injectable()
export class BugHuntEventRepository extends Repository<BugHuntEvent> {
  constructor(dataSource: DataSource) {
    super(BugHuntEvent, dataSource.createEntityManager());
  }

  /**
   * Escalations in the window, grouped by their exact summary text — the
   * cheapest possible breakdown of WHY sessions escalate. Three of the four
   * escalation call sites (BUG_HUNT_ESCALATION_GUIDANCE's model-tier bump,
   * the multi-repo plan, and the suite-still-red-after-cap path — see
   * bug-fix-prompt.ts / bug-hunt-sweep-prompt.ts) already report a FIXED,
   * literal summary string per call site, so grouping on the raw string
   * already separates them cleanly with no new schema or prompt change. The
   * fourth (an open product question) is genuine free text and will fall out
   * as many small one-off groups rather than one clean bucket — expected,
   * not a bug in this query.
   */
  async escalationBreakdown(since: Date): Promise<EscalationBreakdown[]> {
    const rows = await this.createQueryBuilder('e')
      .select('e.summary', 'summary')
      .addSelect('COUNT(*)', 'count')
      .where('e.stage = :stage', { stage: BugHuntEventStage.ESCALATED })
      .andWhere('e.createdAt >= :since', { since })
      .groupBy('e.summary')
      .orderBy('count', 'DESC')
      .getRawMany();
    return rows.map((row) => ({
      summary: row.summary,
      count: Number(row.count),
    }));
  }

  /** Escalation COUNT per calendar week — the numerator of a trended escalation rate. */
  async weeklyEscalationCounts(
    start: Date,
    end: Date,
  ): Promise<Array<{ week: Date; count: number }>> {
    const rows = await this.createQueryBuilder('e')
      .select(`date_trunc('week', e."createdAt")`, 'week')
      .addSelect('COUNT(*)', 'count')
      .where('e.stage = :stage', { stage: BugHuntEventStage.ESCALATED })
      .andWhere('e."createdAt" >= :start', { start })
      .andWhere('e."createdAt" < :end', { end })
      .groupBy('week')
      .orderBy('week', 'ASC')
      .getRawMany();
    return rows.map((row) => ({ week: row.week, count: Number(row.count) }));
  }

  /**
   * How often Gemini's session got stuck and the automatic fallback to
   * Claude fired, per calendar week — `payload.fallback = "gemini-to-claude"`
   * is reported by the fallback logic in `bug-fix-session.yml`/
   * `bug-hunt-sweep.yml` themselves (both sweep and fix session), not by the
   * agent, so this counts independently of `stage`.
   */
  async weeklyFallbackCounts(
    start: Date,
    end: Date,
  ): Promise<Array<{ week: Date; count: number }>> {
    const rows = await this.createQueryBuilder('e')
      .select(`date_trunc('week', e."createdAt")`, 'week')
      .addSelect('COUNT(*)', 'count')
      .where(`e.payload->>'fallback' = 'gemini-to-claude'`)
      .andWhere('e."createdAt" >= :start', { start })
      .andWhere('e."createdAt" < :end', { end })
      .groupBy('week')
      .orderBy('week', 'ASC')
      .getRawMany();
    return rows.map((row) => ({ week: row.week, count: Number(row.count) }));
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
