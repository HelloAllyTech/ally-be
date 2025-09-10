import { BadRequestException, Injectable } from '@nestjs/common';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { ScenarioService } from './scenario.service';
import { ScenarioSessionStatus } from '../enum/scenario-session-status.enum';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { AddFeedbackToScenarioSessionRequestDto } from '../dto/add-feedback-to-scenario-session.dto';
import { Repository } from 'typeorm';
import { ScenarioSessionFeedbacks } from '../entity/scenario-session-feedbacks.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionEventService } from 'src/session-event/service/session-event.service';

@Injectable()
export class ScenarioSessionService {
  private readonly logger: LoggerService;
  constructor(
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioService: ScenarioService,
    private livekitService: LiveKitService,
    private sessionEventService: SessionEventService,
    @InjectRepository(ScenarioSessionFeedbacks)
    private scenarioSessionFeedbacksRepository: Repository<ScenarioSessionFeedbacks>,
  ) {
    this.logger = LoggerService.getInstance(ScenarioSessionService.name);
  }

  async getScenarioSessions(
    counselorId: number,
    options: Pagination,
    statuses?: string,
  ) {
    return this.scenarioSessionRepository.getScenarioSessions(
      counselorId,
      options,
      statuses,
    );
  }

  async getAdminScenarioSessions(options: Pagination) {
    return this.scenarioSessionRepository.getAdminScenarioSessions(options);
  }

  async getScenarioSession(scenarioSessionId: string, counselorId: number) {
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: {
        id: scenarioSessionId,
        counselorId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    return scenarioSession;
  }

  async startScenarioSession(
    counselorId: number,
    startScenarioSessionDto: StartScenarioSessionRequestDto,
  ) {
    await this.validateStartScenarioSession(counselorId);

    const scenario = await this.scenarioService.getScenario(
      startScenarioSessionDto.scenarioId,
    );

    const sessionEvents =
      await this.sessionEventService.getSessionEventsByScenarioId(
        startScenarioSessionDto.scenarioId,
      );

    const scenarioSession =
      await this.scenarioSessionRepository.createScenarioSession(
        counselorId,
        startScenarioSessionDto,
      );

    await this.livekitService.createRoom({
      name: `${scenarioSession.roomId}`,
      metadata: {
        scenario: scenario,
        sessionEvents: sessionEvents,
      },
    });

    const accessToken = await this.generateScenarioSessionToken(
      scenarioSession.roomId,
      counselorId,
    );

    return { scenarioSession, accessToken };
  }

  private async validateStartScenarioSession(counselorId: number) {
    const activeScenarioSessions = await this.getScenarioSessions(
      counselorId,
      {
        limit: 1,
        offset: 0,
      },
      ScenarioSessionStatus.ACTIVE,
    );

    if (activeScenarioSessions.length > 0) {
      throw new BadRequestException(
        `You already have an active scenario session ${activeScenarioSessions[0].id}`,
      );
    }
  }

  async endScenarioSession(scenarioSessionId: string, counselorId: number) {
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: {
        id: scenarioSessionId,
        counselorId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    if (scenarioSession.status !== ScenarioSessionStatus.ACTIVE) {
      throw new BadRequestException('Scenario session is not active');
    }

    // Update scenario session status to ENDED
    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt: new Date(),
    });

    try {
      await this.livekitService.deleteRoom(scenarioSession.roomId);
    } catch (error) {
      this.logger.debug(
        `Failed to delete room: ${JSON.stringify(error.message)}`,
      );
    }

    return { message: 'Scenario session ended successfully' };
  }

  async generateScenarioSessionToken(roomId: string, counselorId: number) {
    return await this.livekitService.generateAccessToken({
      roomName: roomId,
      participantName: counselorId.toString(),
    });
  }

  async addFeedbackToScenarioSession(
    scenarioSessionId: string,
    counselorId: number,
    addFeedbackToScenarioSessionDto: AddFeedbackToScenarioSessionRequestDto,
  ): Promise<ScenarioSessionFeedbacks> {
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: {
        id: scenarioSessionId,
        tenantId: ExecutionManager.getTenantId(),
      },
    });

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    if (scenarioSession.status !== ScenarioSessionStatus.ENDED) {
      throw new BadRequestException('Scenario session is not ended');
    }

    if (scenarioSession.counselorId !== counselorId) {
      throw new BadRequestException(
        'You are not authorized to add feedback to this scenario session',
      );
    }

    const scenarioSessionFeedback =
      this.scenarioSessionFeedbacksRepository.create({
        scenarioSessionId,
        rating: addFeedbackToScenarioSessionDto.rating,
        feedback: addFeedbackToScenarioSessionDto.feedback,
        tenantId: ExecutionManager.getTenantId(),
      });

    return this.scenarioSessionFeedbacksRepository.save(
      scenarioSessionFeedback,
    );
  }
}
