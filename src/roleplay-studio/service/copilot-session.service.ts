import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentTestCase } from 'src/learn/entity/agent-test-case.entity';
import { LoggerService } from 'src/logger/logger.service';
import { CopilotSession } from '../entity/copilot-session.entity';
import { CopilotMessage } from '../entity/copilot-message.entity';
import { CopilotSessionRepository } from '../repository/copilot-session.repository';
import { CopilotMessageRepository } from '../repository/copilot-message.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { CopilotSessionStatus } from '../enum/copilot-session-status.enum';
import { CopilotMessageRole } from '../enum/copilot-message-role.enum';
import { AcceptSuggestedTestCasesDto } from '../dto/copilot.dto';

/**
 * Copilot session lifecycle + non-streaming REST around the transcript.
 * The streamed turn itself lives in CopilotOrchestratorService.
 */
@Injectable()
export class CopilotSessionService {
  private readonly logger = LoggerService.getInstance(
    CopilotSessionService.name,
  );

  constructor(
    private readonly sessionRepository: CopilotSessionRepository,
    private readonly messageRepository: CopilotMessageRepository,
    private readonly roleplaySpecService: RoleplaySpecService,
    private readonly dataSource: DataSource,
  ) {}

  async createSession(specId: string, userId: number): Promise<CopilotSession> {
    // 404s when the spec doesn't exist.
    await this.roleplaySpecService.getSpec(specId);
    return this.sessionRepository.save(
      this.sessionRepository.create({
        specId,
        createdBy: userId,
        updatedBy: userId,
      }),
    );
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

  /**
   * Persist trainer-accepted suggest_test_cases output: create real
   * agent_test_cases rows, then append their ids to the draft spec's
   * agentTestCaseIds (one draft mutation → one version snapshot).
   */
  async acceptSuggestedTestCases(
    sessionId: string,
    dto: AcceptSuggestedTestCasesDto,
    userId: number,
  ): Promise<{ testCaseIds: string[]; specVersionId: string }> {
    const session = await this.getSession(sessionId, userId);
    const spec = await this.roleplaySpecService.getSpec(session.specId);

    const repo = this.dataSource.getRepository(AgentTestCase);
    const created = await repo.save(
      dto.testCases.map((testCase) =>
        repo.create({
          title: testCase.title,
          category: testCase.category,
          description: testCase.description,
          condition: testCase.condition,
          test: testCase.test,
          createdBy: userId,
        }),
      ),
    );
    const newIds = created.map((testCase) => testCase.id);

    const nextDraft = {
      ...spec.draftSpec,
      agentTestCaseIds: [
        ...new Set([...(spec.draftSpec.agentTestCaseIds ?? []), ...newIds]),
      ],
    };
    const { version } = await this.roleplaySpecService.persistDraftMutation(
      spec,
      nextDraft,
      userId,
      RoleplaySpecVersionSource.MANUAL_EDIT,
    );

    // Best-effort transcript marker: lets a resumed chat render the
    // suggestion cards as accepted, and puts the acceptance in the model's
    // history (plain user text turn) so it never re-suggests. Must not fail
    // the accept itself.
    try {
      const titles = created.map((testCase) => testCase.title);
      await this.messageRepository.appendMessage(sessionId, {
        role: CopilotMessageRole.USER,
        content: `[accepted ${created.length} suggested test case(s): ${titles.join(', ')}]`,
        metadata: {
          kind: 'test_cases_accepted',
          suggestionIds: dto.testCases
            .map((testCase) => testCase.suggestionId)
            .filter(Boolean),
          testCaseIds: newIds,
          specVersionId: version.id,
        },
        createdBy: userId,
      });
    } catch (error) {
      this.logger.warn(
        `Could not append test-case acceptance marker to session ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { testCaseIds: newIds, specVersionId: version.id };
  }
}
