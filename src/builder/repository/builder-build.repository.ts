import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderBuildEvent } from '../entity/builder-build-event.entity';
import { BuilderQuestion } from '../entity/builder-question.entity';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderReport } from '../entity/builder-report.entity';
import { BuilderNotification } from '../entity/builder-notification.entity';
import {
  BUILDER_RUN_ACTIVE_STATUSES,
  BuilderQuestionStatus,
  BuilderRunStatus,
} from '../enum/builder.enum';

@Injectable()
export class BuilderBuildRunRepository extends Repository<BuilderBuildRun> {
  constructor(dataSource: DataSource) {
    super(BuilderBuildRun, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<BuilderBuildRun[]> {
    return this.find({ where: { sessionId }, order: { sequence: 'ASC' } });
  }

  findLatest(sessionId: string): Promise<BuilderBuildRun | null> {
    return this.findOne({ where: { sessionId }, order: { sequence: 'DESC' } });
  }

  /** Runs the reconcile pass still has to settle. */
  listActive(): Promise<BuilderBuildRun[]> {
    return this.find({
      where: { status: In(BUILDER_RUN_ACTIVE_STATUSES) },
      order: { dispatchedAt: 'ASC' },
    });
  }

  async nextSequence(sessionId: string): Promise<number> {
    const latest = await this.findLatest(sessionId);
    return (latest?.sequence ?? 0) + 1;
  }
}

@Injectable()
export class BuilderBuildEventRepository extends Repository<BuilderBuildEvent> {
  constructor(private readonly dataSource: DataSource) {
    super(BuilderBuildEvent, dataSource.createEntityManager());
  }

  listByRun(
    runId: string,
    afterSeq = 0,
    limit = 500,
  ): Promise<BuilderBuildEvent[]> {
    return this.createQueryBuilder('event')
      .where('event.runId = :runId', { runId })
      .andWhere('event.seq > :afterSeq', { afterSeq })
      .orderBy('event.seq', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Append a batch with gapless per-run seq, allocated by one atomic
   * `UPDATE … RETURNING` on the run row.
   *
   * Batched rather than per-event because the forwarder ships 20 at a time: a
   * per-event transaction would mean twenty round-trips and twenty counter
   * bumps for what is, from the run's point of view, one flush.
   */
  async appendBatch(
    runId: string,
    events: {
      sessionId: string;
      stage?: string | null;
      type: string;
      payload: Record<string, any>;
    }[],
  ): Promise<BuilderBuildEvent[]> {
    if (events.length === 0) return [];

    return this.dataSource.transaction(async (em) => {
      // Reserve the whole block in one bump so a concurrent flush cannot
      // interleave into the middle of this batch's numbering.
      const result = await em.query(
        `UPDATE "builder_build_runs"
            SET "lastEventSeq" = "lastEventSeq" + $2, "updatedAt" = now()
          WHERE id = $1
          RETURNING "lastEventSeq"`,
        [runId, events.length],
      );
      const rows: { lastEventSeq: number }[] = Array.isArray(result?.[0])
        ? result[0]
        : result;
      const endSeq = rows?.[0]?.lastEventSeq;
      if (endSeq === undefined) {
        throw new NotFoundException(`Builder run not found: ${runId}`);
      }

      const startSeq = Number(endSeq) - events.length;
      const repo = em.getRepository(BuilderBuildEvent);
      return repo.save(
        events.map((event, index) =>
          repo.create({
            runId,
            sessionId: event.sessionId,
            seq: startSeq + index + 1,
            stage: event.stage as any,
            type: event.type as any,
            payload: event.payload,
          }),
        ),
      );
    });
  }
}

@Injectable()
export class BuilderQuestionRepository extends Repository<BuilderQuestion> {
  constructor(dataSource: DataSource) {
    super(BuilderQuestion, dataSource.createEntityManager());
  }

  listPending(sessionId: string): Promise<BuilderQuestion[]> {
    return this.find({
      where: { sessionId, status: BuilderQuestionStatus.PENDING },
      order: { position: 'ASC' },
    });
  }

  listByGroup(groupId: string): Promise<BuilderQuestion[]> {
    return this.find({ where: { groupId }, order: { position: 'ASC' } });
  }

  /** True once every question in the group has an answer. */
  async isGroupComplete(groupId: string): Promise<boolean> {
    const pending = await this.count({
      where: { groupId, status: BuilderQuestionStatus.PENDING },
    });
    return pending === 0;
  }
}

@Injectable()
export class BuilderPullRequestRepository extends Repository<BuilderPullRequest> {
  constructor(dataSource: DataSource) {
    super(BuilderPullRequest, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<BuilderPullRequest[]> {
    return this.find({ where: { sessionId }, order: { repo: 'ASC' } });
  }

  /** Open PRs across all sessions — what the reconcile pass refreshes. */
  listUnmerged(): Promise<BuilderPullRequest[]> {
    return this.find({ where: { merged: false } });
  }
}

@Injectable()
export class BuilderReportRepository extends Repository<BuilderReport> {
  constructor(dataSource: DataSource) {
    super(BuilderReport, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<BuilderReport[]> {
    return this.find({ where: { sessionId }, order: { createdAt: 'DESC' } });
  }
}

@Injectable()
export class BuilderNotificationRepository extends Repository<BuilderNotification> {
  constructor(dataSource: DataSource) {
    super(BuilderNotification, dataSource.createEntityManager());
  }

  listForAdmin(
    adminId: number,
    unreadOnly = false,
  ): Promise<BuilderNotification[]> {
    return this.find({
      where: { adminId, ...(unreadOnly ? { readAt: IsNull() } : {}) },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  countUnread(adminId: number): Promise<number> {
    return this.count({ where: { adminId, readAt: IsNull() } });
  }
}

/** Re-exported so callers can name a terminal run status without the enum import. */
export const BUILDER_RUN_TERMINAL_STATUSES: BuilderRunStatus[] = [
  BuilderRunStatus.SUCCEEDED,
  BuilderRunStatus.FAILED,
  BuilderRunStatus.CANCELLED,
  BuilderRunStatus.TIMED_OUT,
  BuilderRunStatus.WAITING_FOR_INPUT,
];
