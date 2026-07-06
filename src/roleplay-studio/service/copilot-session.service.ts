import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentTestCase } from 'src/learn/entity/agent-test-case.entity';
import { CopilotSession } from '../entity/copilot-session.entity';
import { CopilotMessage } from '../entity/copilot-message.entity';
import { CopilotSessionRepository } from '../repository/copilot-session.repository';
import { CopilotMessageRepository } from '../repository/copilot-message.repository';
import { RoleplaySpecService } from './roleplay-spec.service';
import { RoleplaySpecVersionSource } from '../enum/roleplay-spec-version-source.enum';
import { AcceptSuggestedTestCasesDto } from '../dto/copilot.dto';

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
    return { testCaseIds: newIds, specVersionId: version.id };
  }
}
