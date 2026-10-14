import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { CourseCopilotSession } from '../entity/course-copilot-session.entity';
import { CourseCopilotMessage } from '../entity/course-copilot-message.entity';
import { CourseCopilotJob } from '../entity/course-copilot-job.entity';
import { CourseCopilotEvent } from '../entity/course-copilot-event.entity';
import {
  CourseCopilotEventType,
  CourseCopilotJobStatus,
  CourseCopilotMessageRole,
} from '../enum/course-copilot.enum';
import { CourseCopilotJobResult } from '../type/course-copilot.type';

/**
 * Pull the rows out of `EntityManager.query()` for a RETURNING UPDATE.
 *
 * On Postgres that call returns a `[rows, affectedCount]` tuple, not a bare
 * rows array — reading it as rows is how Builder's copilot once reported
 * "session not found" for a session that existed.
 */
function returningRows<T>(result: any): T[] {
  return (Array.isArray(result?.[0]) ? result[0] : result) as T[];
}

@Injectable()
export class CourseCopilotSessionRepository extends Repository<CourseCopilotSession> {
  constructor(dataSource: DataSource) {
    super(CourseCopilotSession, dataSource.createEntityManager());
  }
}

@Injectable()
export class CourseCopilotMessageRepository extends Repository<CourseCopilotMessage> {
  constructor(private readonly dataSource: DataSource) {
    super(CourseCopilotMessage, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<CourseCopilotMessage[]> {
    return this.find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  /**
   * Append with a gapless, per-session-unique seq allocated by an atomic
   * UPDATE … RETURNING on the session inside the same transaction as the
   * insert, so concurrent appenders cannot collide on (sessionId, seq).
   */
  async appendMessage(
    sessionId: string,
    message: {
      role: CourseCopilotMessageRole;
      content?: string | null;
      toolCalls?: Record<string, any>[] | null;
      toolResults?: Record<string, any>[] | null;
      metadata?: Record<string, any> | null;
      createdBy?: number | null;
    },
  ): Promise<CourseCopilotMessage> {
    return this.dataSource.transaction(async (em) => {
      const rows = returningRows<{ lastMessageSeq: number }>(
        await em.query(
          `UPDATE "course_copilot_sessions"
              SET "lastMessageSeq" = "lastMessageSeq" + 1, "updatedAt" = now()
            WHERE id = $1 AND "deletedAt" IS NULL
            RETURNING "lastMessageSeq"`,
          [sessionId],
        ),
      );
      const seq = rows?.[0]?.lastMessageSeq;
      if (seq === undefined) {
        // NotFoundException so the stream controller tags the frame
        // `session_not_found` and the client re-creates instead of dead-ending.
        throw new NotFoundException(
          `Course Copilot session not found: ${sessionId}`,
        );
      }
      const repo = em.getRepository(CourseCopilotMessage);
      return repo.save(
        repo.create({ sessionId, seq: Number(seq), ...message }),
      );
    });
  }

  /** Overwrite the in-flight assistant row with the turn's progress so far. */
  async checkpointMessage(
    messageId: string,
    patch: {
      content?: string | null;
      toolCalls?: Record<string, any>[] | null;
      toolResults?: Record<string, any>[] | null;
      metadata?: Record<string, any> | null;
    },
  ): Promise<void> {
    await this.update(messageId, patch);
  }

  /**
   * Close rows left mid-stream by a turn that never finished. Run at the start
   * of the next turn, not on boot: a boot sweep would race turns still
   * streaming on another ECS task.
   */
  async closeInterruptedMessages(sessionId: string): Promise<number> {
    const recent = await this.find({
      where: { sessionId, role: CourseCopilotMessageRole.ASSISTANT },
      order: { seq: 'DESC' },
      take: 4,
    });
    let closed = 0;
    for (const message of recent) {
      if (!message.metadata?.streaming) continue;
      await this.checkpointMessage(message.id, {
        metadata: {
          ...message.metadata,
          streaming: false,
          interrupted: true,
          stopReason: message.metadata.stopReason ?? 'interrupted',
        },
      });
      closed += 1;
    }
    return closed;
  }
}

@Injectable()
export class CourseCopilotJobRepository extends Repository<CourseCopilotJob> {
  constructor(dataSource: DataSource) {
    super(CourseCopilotJob, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<CourseCopilotJob[]> {
    return this.find({ where: { sessionId }, order: { createdAt: 'ASC' } });
  }

  /**
   * Claim a queued job for this runner: `queued` → `running` in one
   * conditional statement. Returns null when another runner got there first —
   * which is what makes overlapping runners after a deploy harmless.
   */
  async claim(jobId: string): Promise<CourseCopilotJob | null> {
    const rows = returningRows<{ id: string }>(
      await this.manager.query(
        `UPDATE "course_copilot_jobs"
            SET "status" = 'running', "attempts" = "attempts" + 1,
                "startedAt" = COALESCE("startedAt", now()),
                "heartbeatAt" = now(), "error" = NULL, "updatedAt" = now()
          WHERE id = $1 AND "status" = 'queued'
          RETURNING id`,
        [jobId],
      ),
    );
    if (!rows.length) return null;
    return this.findOne({ where: { id: jobId } });
  }

  async heartbeat(jobId: string): Promise<void> {
    await this.manager.query(
      `UPDATE "course_copilot_jobs" SET "heartbeatAt" = now()
        WHERE id = $1 AND "status" = 'running'`,
      [jobId],
    );
  }

  /** Settle a running job. Conditional so a reconciled-away job is not resurrected. */
  async settle(
    jobId: string,
    status: CourseCopilotJobStatus,
    patch: { result?: CourseCopilotJobResult | null; error?: string | null },
  ): Promise<boolean> {
    const rows = returningRows<{ id: string }>(
      await this.manager.query(
        `UPDATE "course_copilot_jobs"
            SET "status" = $2::varchar, "result" = COALESCE($3::jsonb, "result"),
                "error" = $4::text, "finishedAt" = now(), "updatedAt" = now()
          WHERE id = $1 AND "status" = 'running'
          RETURNING id`,
        [
          jobId,
          status,
          patch.result === undefined || patch.result === null
            ? null
            : JSON.stringify(patch.result),
          patch.error ?? null,
        ],
      ),
    );
    return rows.length > 0;
  }

  /** Back to the queue for a repair pass, keeping `attempts`. */
  async requeueForRepair(jobId: string, error: string): Promise<void> {
    await this.manager.query(
      `UPDATE "course_copilot_jobs"
          SET "status" = 'queued', "error" = $2, "updatedAt" = now()
        WHERE id = $1 AND "status" = 'running'`,
      [jobId, error],
    );
  }

  async setStatus(
    jobIds: string[],
    from: CourseCopilotJobStatus[],
    to: CourseCopilotJobStatus,
    extra: { error?: string | null; resetAttempts?: boolean } = {},
  ): Promise<string[]> {
    if (!jobIds.length) return [];
    const rows = returningRows<{ id: string }>(
      await this.manager.query(
        `UPDATE "course_copilot_jobs"
            SET "status" = $3::varchar,
                "error" = CASE WHEN $4::boolean THEN $5::text ELSE "error" END,
                "attempts" = CASE WHEN $6::boolean THEN 0 ELSE "attempts" END,
                -- Explicit casts: $3 appears twice and Postgres refuses to
                -- deduce one type for it from a column and an IN list.
                "finishedAt" = CASE WHEN $3::varchar IN ('done','failed','skipped') THEN now() ELSE NULL END,
                "updatedAt" = now()
          WHERE id = ANY($1::uuid[]) AND "status" = ANY($2::varchar[])
          RETURNING id`,
        [
          jobIds,
          from,
          to,
          extra.error !== undefined,
          extra.error ?? null,
          Boolean(extra.resetAttempts),
        ],
      ),
    );
    return rows.map((row) => row.id);
  }

  /** Running jobs whose heartbeat is older than `staleMs`. */
  async findStale(staleMs: number): Promise<CourseCopilotJob[]> {
    return this.createQueryBuilder('job')
      .where('job.status = :status', { status: CourseCopilotJobStatus.RUNNING })
      .andWhere(
        `COALESCE(job."heartbeatAt", job."startedAt", job."createdAt") < now() - make_interval(secs => :seconds)`,
        { seconds: Math.round(staleMs / 1000) },
      )
      .getMany();
  }

  countByStatus(sessionId: string, statuses: CourseCopilotJobStatus[]) {
    return this.count({ where: { sessionId, status: In(statuses) } });
  }
}

@Injectable()
export class CourseCopilotEventRepository extends Repository<CourseCopilotEvent> {
  constructor(private readonly dataSource: DataSource) {
    super(CourseCopilotEvent, dataSource.createEntityManager());
  }

  /** Append a batch with contiguous seqs allocated from the session counter. */
  async appendBatch(
    sessionId: string,
    events: { type: CourseCopilotEventType; payload: Record<string, any> }[],
  ): Promise<CourseCopilotEvent[]> {
    if (!events.length) return [];
    return this.dataSource.transaction(async (em) => {
      const rows = returningRows<{ lastEventSeq: number }>(
        await em.query(
          `UPDATE "course_copilot_sessions"
              SET "lastEventSeq" = "lastEventSeq" + $2
            WHERE id = $1
            RETURNING "lastEventSeq"`,
          [sessionId, events.length],
        ),
      );
      const last = rows?.[0]?.lastEventSeq;
      if (last === undefined) return [];
      const first = Number(last) - events.length + 1;
      const repo = em.getRepository(CourseCopilotEvent);
      return repo.save(
        events.map((event, index) =>
          repo.create({
            sessionId,
            seq: first + index,
            type: event.type,
            payload: event.payload,
          }),
        ),
      );
    });
  }

  listAfter(
    sessionId: string,
    afterSeq: number,
    limit: number,
  ): Promise<CourseCopilotEvent[]> {
    return this.createQueryBuilder('event')
      .where('event.sessionId = :sessionId', { sessionId })
      .andWhere('event.seq > :afterSeq', { afterSeq })
      .orderBy('event.seq', 'ASC')
      .limit(limit)
      .getMany();
  }
}
