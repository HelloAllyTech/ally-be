import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MoreThanOrEqual } from 'typeorm';
import { CharacterInterviewSession } from '../entity/character-interview-session.entity';
import { CharacterInterviewMessage } from '../entity/character-interview-message.entity';
import { CharacterInterviewSessionRepository } from '../repository/character-interview-session.repository';
import { CharacterInterviewMessageRepository } from '../repository/character-interview-message.repository';
import { CharacterInterviewSessionStatus } from '../enum/character-interview.enum';
import {
  CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT,
  CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH,
} from '../constants/character-interview.constants';
import { CharacterLibraryAccessService } from './character-library-access.service';

/**
 * Interview session lifecycle + non-streaming REST around the transcript.
 * The streamed turn itself lives in CharacterInterviewOrchestratorService.
 */
@Injectable()
export class CharacterInterviewSessionService {
  constructor(
    private readonly sessionRepository: CharacterInterviewSessionRepository,
    private readonly messageRepository: CharacterInterviewMessageRepository,
    private readonly accessService: CharacterLibraryAccessService,
  ) {}

  async createSession(userId: number): Promise<CharacterInterviewSession> {
    const scope = await this.accessService.resolveScope();
    if (!scope.isPlatform) {
      await this.assertTenantWithinCaps(scope.tenantId!);
    }

    return this.sessionRepository.save(
      this.sessionRepository.create({
        tenantId: scope.tenantId,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  /**
   * Refuse a new interview once an org is at either cap. The message names the
   * limit and the way out — "finish or abandon one of your open interviews" is
   * actionable; a bare 429 is not.
   */
  private async assertTenantWithinCaps(tenantId: string): Promise<void> {
    const activeCount = await this.sessionRepository.count({
      where: { tenantId, status: CharacterInterviewSessionStatus.ACTIVE },
    });
    if (activeCount >= CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT) {
      throw new ForbiddenException(
        `Your organisation already has ${CHARACTER_INTERVIEW_MAX_ACTIVE_SESSIONS_PER_TENANT} interviews in progress. ` +
          'Finish or discard one before starting another.',
      );
    }

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const monthCount = await this.sessionRepository.count({
      where: { tenantId, createdAt: MoreThanOrEqual(monthStart) },
    });
    if (monthCount >= CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH) {
      throw new ForbiddenException(
        `Your organisation has reached its limit of ${CHARACTER_INTERVIEW_MAX_SESSIONS_PER_TENANT_PER_MONTH} character interviews this month. ` +
          'Contact Ally support if you need a higher limit.',
      );
    }
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
