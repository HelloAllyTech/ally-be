import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CopilotSession } from '../entity/copilot-session.entity';
import { CopilotMessage } from '../entity/copilot-message.entity';
import { CopilotSessionRepository } from '../repository/copilot-session.repository';
import { CopilotMessageRepository } from '../repository/copilot-message.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { CopilotSessionStatus } from '../enum/copilot-session-status.enum';
import { CopilotSessionMode } from '../enum/copilot-session-mode.enum';

/**
 * Copilot session lifecycle + non-streaming REST around the transcript.
 * The streamed turn itself lives in CopilotOrchestratorService.
 */
@Injectable()
export class CopilotSessionService {
  constructor(
    private readonly sessionRepository: CopilotSessionRepository,
    private readonly messageRepository: CopilotMessageRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
  ) {}

  async createSession(
    specId: string,
    userId: number,
    mode: CopilotSessionMode = CopilotSessionMode.BUILDING,
  ): Promise<CopilotSession> {
    // 404s when the spec doesn't exist.
    await this.roleplaySpecService.getSpec(specId);
    return this.sessionRepository.save(
      this.sessionRepository.create({
        specId,
        mode,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
  }

  /**
   * Flip a session between BUILDING and ITERATING. The studio calls this when
   * the trainer switches to Iterate mode after building (and back). No-op-safe:
   * setting the current mode just returns the session. Ownership-guarded.
   */
  async setMode(
    sessionId: string,
    mode: CopilotSessionMode,
    userId: number,
  ): Promise<CopilotSession> {
    const session = await this.getSession(sessionId, userId);
    if (session.mode === mode) {
      return session;
    }
    session.mode = mode;
    session.updatedBy = userId;
    return this.sessionRepository.save(session);
  }

  async getSession(
    sessionId: string,
    userId?: number,
  ): Promise<CopilotSession> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException('Copilot session not found');
    }
    // Copilot sessions are personal working conversations — only the creator
    // may read or continue one.
    if (userId !== undefined && session.createdBy !== userId) {
      throw new ForbiddenException('Not your copilot session');
    }
    return session;
  }

  async listSessions(specId: string): Promise<CopilotSession[]> {
    await this.roleplaySpecService.getSpec(specId);
    return this.sessionRepository.find({
      where: { specId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * The caller's own ACTIVE sessions for a spec, newest first — the web's
   * cross-browser resume path (sessions are personal, so the ownership
   * filter is mandatory here).
   */
  async listOwnedSessions(
    specId: string,
    userId: number,
  ): Promise<CopilotSession[]> {
    await this.roleplaySpecService.getSpec(specId);
    return this.sessionRepository.find({
      where: {
        specId,
        createdBy: userId,
        status: CopilotSessionStatus.ACTIVE,
      },
      order: { createdAt: 'DESC' },
    });
  }

  /** Session + full transcript — the shape the studio resumes from. */
  async getSessionWithMessages(
    sessionId: string,
    userId: number,
  ): Promise<CopilotSession & { messages: CopilotMessage[] }> {
    const session = await this.getSession(sessionId, userId);
    const messages = await this.messageRepository.listBySession(sessionId);
    return { ...session, messages };
  }

  async listMessages(
    sessionId: string,
    userId: number,
  ): Promise<CopilotMessage[]> {
    await this.getSession(sessionId, userId);
    return this.messageRepository.listBySession(sessionId);
  }
}
