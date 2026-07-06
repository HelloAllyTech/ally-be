import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CopilotMessage } from '../entity/copilot-message.entity';
import { CopilotSession } from '../entity/copilot-session.entity';
import { CopilotMessageRole } from '../enum/copilot-message-role.enum';

@Injectable()
export class CopilotMessageRepository extends Repository<CopilotMessage> {
  constructor(private readonly dataSource: DataSource) {
    super(CopilotMessage, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<CopilotMessage[]> {
    return this.find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  /**
   * Append a message with a gapless, per-session-unique seq. The seq is
   * allocated by an atomic UPDATE … RETURNING on copilot_sessions inside one
   * transaction with the insert, so concurrent appenders can never collide on
   * the (sessionId, seq) unique index.
   */
  async appendMessage(
    sessionId: string,
    message: {
      role: CopilotMessageRole;
      content?: string | null;
      toolCalls?: Record<string, any>[] | null;
      toolResults?: Record<string, any>[] | null;
      specDiff?: Record<string, any>[] | null;
      metadata?: Record<string, any> | null;
      createdBy?: number;
    },
  ): Promise<CopilotMessage> {
    return this.dataSource.transaction(async (em) => {
      // Atomic seq allocation via UPDATE … RETURNING. Use the query builder,
      // not em.query: in TypeORM 0.3 a raw UPDATE query resolves to the tuple
      // [returnedRows, affectedCount], so `rows[0].lastMessageSeq` would be
      // undefined and every first append would spuriously 404. UpdateResult
      // exposes the returned rows cleanly on `.raw` and the match on `.affected`
      // (which also refreshes updatedAt via the @UpdateDateColumn).
      const result = await em
        .createQueryBuilder()
        .update(CopilotSession)
        .set({ lastMessageSeq: () => '"lastMessageSeq" + 1' })
        .where('id = :sessionId', { sessionId })
        .returning('"lastMessageSeq"')
        .execute();

      if (!result.affected) {
        throw new NotFoundException(`Copilot session not found: ${sessionId}`);
      }
      const seq = (result.raw as { lastMessageSeq: number }[])[0]
        .lastMessageSeq;
      const repo = em.getRepository(CopilotMessage);
      return repo.save(
        repo.create({ sessionId, seq: Number(seq), ...message }),
      );
    });
  }

  async getSessionOrNull(sessionId: string): Promise<CopilotSession | null> {
    return this.dataSource
      .getRepository(CopilotSession)
      .findOne({ where: { id: sessionId } });
  }
}
