import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BuilderMessage } from '../entity/builder-message.entity';
import { BuilderMessageRole } from '../enum/builder.enum';

@Injectable()
export class BuilderMessageRepository extends Repository<BuilderMessage> {
  constructor(private readonly dataSource: DataSource) {
    super(BuilderMessage, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<BuilderMessage[]> {
    return this.find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  /**
   * Append a message with a gapless, per-session-unique seq. The seq is
   * allocated by an atomic UPDATE … RETURNING on builder_sessions inside one
   * transaction with the insert, so concurrent appenders can never collide on
   * the (sessionId, seq) unique index.
   */
  async appendMessage(
    sessionId: string,
    message: {
      role: BuilderMessageRole;
      content?: string | null;
      toolCalls?: Record<string, any>[] | null;
      toolResults?: Record<string, any>[] | null;
      metadata?: Record<string, any> | null;
      createdBy?: number;
    },
  ): Promise<BuilderMessage> {
    return this.dataSource.transaction(async (em) => {
      // EntityManager.query() returns a `[rows, affectedCount]` tuple for a
      // RETURNING UPDATE on Postgres — NOT a bare rows array.
      const result = await em.query(
        `UPDATE "builder_sessions"
            SET "lastMessageSeq" = "lastMessageSeq" + 1, "updatedAt" = now()
          WHERE id = $1
          RETURNING "lastMessageSeq"`,
        [sessionId],
      );
      const rows: { lastMessageSeq: number }[] = Array.isArray(result?.[0])
        ? result[0]
        : result;
      const seq = rows?.[0]?.lastMessageSeq;
      if (seq === undefined) {
        // NotFoundException (not a bare Error) so the stream controller tags
        // the SSE error frame `session_not_found` and the client recovers by
        // re-creating the session rather than dead-ending.
        throw new NotFoundException(`Builder session not found: ${sessionId}`);
      }
      const repo = em.getRepository(BuilderMessage);
      return repo.save(
        repo.create({ sessionId, seq: Number(seq), ...message }),
      );
    });
  }

  /**
   * Overwrite an in-flight assistant row with the turn's progress so far.
   *
   * The transcript is append-only *between* turns; the row for the turn that
   * is currently streaming is the one exception, and it exists because a turn
   * can run for minutes across sixteen tool round-trips. Before this, all of
   * that — the prose already streamed to the admin's screen and the record of
   * every tool the agent had run — lived only in the orchestrator's local
   * arrays until the turn ended, so a deploy or a restart mid-turn left the
   * session showing an admin question with no reply and no trace of the work
   * that had already been done and paid for.
   *
   * `metadata.streaming` marks the row as still moving. Nothing reads a
   * checkpoint back into the model within the turn; it exists for the admin
   * reloading the page and for the next turn's history rebuild.
   */
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
   * Close out rows left mid-stream by a turn that never finished.
   *
   * Called at the start of the next turn rather than on boot: a row can only
   * be stale once someone comes back to the session, and a boot-time sweep
   * would race with turns still streaming on another replica.
   */
  async closeInterruptedMessages(sessionId: string): Promise<number> {
    const stale = await this.find({
      where: { sessionId, role: BuilderMessageRole.ASSISTANT },
      order: { seq: 'DESC' },
      take: 4,
    });
    let closed = 0;
    for (const message of stale) {
      if (!message.metadata?.streaming) continue;
      const metadata: Record<string, any> = {
        ...message.metadata,
        streaming: false,
        interrupted: true,
        stopReason: message.metadata.stopReason ?? 'interrupted',
      };
      await this.checkpointMessage(message.id, { metadata });
      closed += 1;
    }
    return closed;
  }
}
