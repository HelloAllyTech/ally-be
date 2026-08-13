import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CharacterInterviewMessage } from '../entity/character-interview-message.entity';
import { CharacterInterviewMessageRole } from '../enum/character-interview.enum';

@Injectable()
export class CharacterInterviewMessageRepository extends Repository<CharacterInterviewMessage> {
  constructor(private readonly dataSource: DataSource) {
    super(CharacterInterviewMessage, dataSource.createEntityManager());
  }

  listBySession(sessionId: string): Promise<CharacterInterviewMessage[]> {
    return this.find({ where: { sessionId }, order: { seq: 'ASC' } });
  }

  /**
   * Append a message with a gapless, per-session-unique seq. The seq is
   * allocated by an atomic UPDATE … RETURNING on character_interview_sessions
   * inside one transaction with the insert, so concurrent appenders can never
   * collide on the (sessionId, seq) unique index.
   */
  async appendMessage(
    sessionId: string,
    message: {
      role: CharacterInterviewMessageRole;
      content?: string | null;
      toolCalls?: Record<string, any>[] | null;
      toolResults?: Record<string, any>[] | null;
      metadata?: Record<string, any> | null;
      createdBy?: number;
    },
  ): Promise<CharacterInterviewMessage> {
    return this.dataSource.transaction(async (em) => {
      // EntityManager.query() returns a `[rows, affectedCount]` tuple for a
      // RETURNING UPDATE on Postgres — NOT a bare rows array (see the same
      // unwrap in CopilotMessageRepository.appendMessage).
      const result = await em.query(
        `UPDATE "character_interview_sessions"
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
        // the SSE error frame `session_not_found` and the client can recover
        // by re-creating the session.
        throw new NotFoundException(
          `Character interview session not found: ${sessionId}`,
        );
      }
      const repo = em.getRepository(CharacterInterviewMessage);
      return repo.save(
        repo.create({ sessionId, seq: Number(seq), ...message }),
      );
    });
  }
}
