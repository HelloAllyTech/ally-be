import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CharacterInterviewSession } from '../entity/character-interview-session.entity';
import { CharacterInterviewMessage } from '../entity/character-interview-message.entity';
import { CharacterInterviewSessionRepository } from '../repository/character-interview-session.repository';
import { CharacterInterviewMessageRepository } from '../repository/character-interview-message.repository';
import { CharacterInterviewSessionStatus } from '../enum/character-interview.enum';

/**
 * Interview session lifecycle + non-streaming REST around the transcript.
 * The streamed turn itself lives in CharacterInterviewOrchestratorService.
 */
@Injectable()
export class CharacterInterviewSessionService {
  constructor(
    private readonly sessionRepository: CharacterInterviewSessionRepository,
    private readonly messageRepository: CharacterInterviewMessageRepository,
  ) {}

  createSession(userId: number): Promise<CharacterInterviewSession> {
    return this.sessionRepository.save(
      this.sessionRepository.create({
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  async getSession(
    sessionId: string,
    userId?: number,
  ): Promise<CharacterInterviewSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Character interview session not found');
    }
    // Interviews are personal working conversations — only the creator may
    // read or continue one.
    if (userId !== undefined && session.createdBy !== userId) {
      throw new ForbiddenException('Not your interview session');
    }
    return session;
  }

  /**
   * The caller's own ACTIVE sessions, newest first — the web's cross-browser
   * resume path.
   */
  listOwnedSessions(userId: number): Promise<CharacterInterviewSession[]> {
    return this.sessionRepository.find({
      where: {
        createdBy: userId,
        status: CharacterInterviewSessionStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /** Session + full transcript — the shape the chat page resumes from. */
  async getSessionWithMessages(
    sessionId: string,
    userId: number,
  ): Promise<
    CharacterInterviewSession & { messages: CharacterInterviewMessage[] }
  > {
    const session = await this.getSession(sessionId, userId);
    const messages = await this.messageRepository.listBySession(sessionId);
    return { ...session, messages };
  }
}
