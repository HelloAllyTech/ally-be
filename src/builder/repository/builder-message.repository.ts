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
}
