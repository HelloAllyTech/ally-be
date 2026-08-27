import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { BuilderBuildRun } from '../entity/builder-build-run.entity';
import { BuilderBuildEvent } from '../entity/builder-build-event.entity';
import { BuilderQuestion } from '../entity/builder-question.entity';
import { BuilderPullRequest } from '../entity/builder-pull-request.entity';
import { BuilderPrFeedback } from '../entity/builder-pr-feedback.entity';
import { BuilderReport } from '../entity/builder-report.entity';
import { BuilderNotification } from '../entity/builder-notification.entity';
import {
  BUILDER_RUN_ACTIVE_STATUSES,
  BuilderPrFeedbackKind,
  BuilderPrFeedbackStatus,
  BuilderQuestionStatus,
  BuilderRunStatus,
} from '../enum/builder.enum';

@Injectable()
export class BuilderBuildRunRepository extends Repository<BuilderBuildRun> {
  constructor(private readonly dataSource: DataSource) {
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

  /**
   * The next run number for a session, allocated atomically.
   *
   * Read-then-increment was a race: two dispatches for one session — a
   * double-clicked answer, an auto-dispatched follow-up landing beside a
   * manual retry — would read the same `MAX(sequence)` and collide. Uses the
   * same `UPDATE … RETURNING` counter primitive as `lastMessageSeq` and
   * `lastEventSeq`, which is the house answer for exactly this.
   */
  async nextSequence(sessionId: string): Promise<number> {
    // EntityManager.query() returns a `[rows, affectedCount]` tuple for a
    // RETURNING UPDATE on Postgres — NOT a bare rows array.
    const result = await this.dataSource.query(
      `UPDATE "builder_sessions"
          SET "lastRunSequence" = "lastRunSequence" + 1, "updatedAt" = now()
        WHERE id = $1
        RETURNING "lastRunSequence"`,
      [sessionId],
    );
    const rows: { lastRunSequence: number }[] = Array.isArray(result?.[0])
      ? result[0]
      : result;
    const sequence = rows?.[0]?.lastRunSequence;
    if (sequence === undefined) {
      throw new NotFoundException(`Builder session not found: ${sessionId}`);
    }
    return Number(sequence);
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

  /**
   * PRs the reconcile pass still has anything to learn about.
   *
   * Excludes closed ones as well as merged: `listUnmerged` used to poll a PR
   * closed without merging forever, one GitHub call every five minutes for the
   * rest of the deployment's life. A null `state` is still polled — it means
   * the row predates state tracking and has never been read.
   */
  listReconcilable(): Promise<BuilderPullRequest[]> {
    return this.find({
      where: [
        { merged: false, state: IsNull() },
        { merged: false, state: 'open' },
      ],
    });
  }
}

@Injectable()
export class BuilderPrFeedbackRepository extends Repository<BuilderPrFeedback> {
  constructor(dataSource: DataSource) {
    super(BuilderPrFeedback, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<BuilderPrFeedback[]> {
    return this.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Feedback a fix run should take on, oldest first. */
  listActionable(pullRequestId: string): Promise<BuilderPrFeedback[]> {
    return this.find({
      where: [
        { pullRequestId, status: BuilderPrFeedbackStatus.PENDING },
        // IN_FIX is included so a fix run that died mid-flight does not leave
        // its items permanently claimed and invisible to the next one.
        { pullRequestId, status: BuilderPrFeedbackStatus.IN_FIX },
      ],
      order: { createdAt: 'ASC' },
    });
  }

  countPending(pullRequestId: string): Promise<number> {
    return this.count({
      where: { pullRequestId, status: BuilderPrFeedbackStatus.PENDING },
    });
  }

  /**
   * Insert if this is new, leave it alone if it is not.
   *
   * The whole point of the unique `(pullRequestId, kind, externalId)` index:
   * feedback is polled, so every tick re-reads every comment. `ON CONFLICT DO
   * NOTHING` also means a human editing their comment does not resurrect an
   * item Builder already addressed.
   */
  async upsertIfNew(feedback: {
    pullRequestId: string;
    sessionId: string;
    kind: BuilderPrFeedbackKind;
    externalId: string;
    author?: string | null;
    body?: string | null;
    path?: string | null;
    line?: number | null;
    /**
     * Defaults to PENDING — actionable work. Pass OBSERVED for something worth
     * recording that Builder must not act on.
     *
     * Whatever the first write says is what the row keeps: `orIgnore` means a
     * later tick cannot correct it. That is a property callers have to respect
     * rather than work around — see `ingestFeedback`, which would rather skip a
     * tick than write a status it is unsure of.
     */
    status?: BuilderPrFeedbackStatus;
  }): Promise<boolean> {
    const result = await this.createQueryBuilder()
      .insert()
      .values({
        ...feedback,
        status: feedback.status ?? BuilderPrFeedbackStatus.PENDING,
      })
      .orIgnore()
      .execute();
    return (result.identifiers?.filter(Boolean).length ?? 0) > 0;
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
