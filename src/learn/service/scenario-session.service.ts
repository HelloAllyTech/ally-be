import { BadRequestException, Injectable } from '@nestjs/common';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { ScenarioService } from './scenario.service';
import { ScenarioSessionStatus } from '../enum/scenario-session-status.enum';
import { LiveKitService } from 'src/livekit/service/livekit.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { LoggerService } from 'src/logger/logger.service';
import { AddFeedbackToScenarioSessionRequestDto } from '../dto/add-feedback-to-scenario-session.dto';
import { DataSource, Repository } from 'typeorm';
import { ScenarioSessionFeedbacks } from '../entity/scenario-session-feedbacks.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { SessionEventService } from 'src/session-event/service/session-event.service';
import { ScenarioSessionMessages } from '../entity/scenario-session-messages.entity';
import { ScenarioSessionMessageType } from '../enum/scenario-session-message.type.enum';
import { AiService } from 'src/ai/service/ai.service';
import { ScenarioSessionDetails } from '../entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from '../entity/scenario-session-events.entity';
import { MessageRequest } from 'src/ai/dto/ai.request.dto';
import { LearnEventData } from '../interface/learn-message.interface';
import { CreateScenarioEventsDto } from '../dto/create-scenario-events.dto';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';


@Injectable()
export class ScenarioSessionService {
  private readonly logger: LoggerService;
  constructor(
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private scenarioService: ScenarioService,
    private livekitService: LiveKitService,
    private sessionEventService: SessionEventService,
    @InjectRepository(ScenarioSessionFeedbacks)
    private scenarioSessionFeedbacksRepository: Repository<ScenarioSessionFeedbacks>,
    private dataSource: DataSource,
    private aiService: AiService,
    @InjectRepository(ScenarioSessionEvents)
    private scenarioSessionEventsRepository: Repository<ScenarioSessionEvents>,
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
    const scenarioSession =
      await this.scenarioSessionRepository.getScenarioSession(
        scenarioSessionId,
        counselorId,
      );

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    const feedback = await this.scenarioSessionFeedbacksRepository.findOne({
      where: { scenarioSessionId },
    });

    const hasFeedback = !!feedback;

    return { ...scenarioSession, hasFeedback };
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

  async mapEventsToScenario(createScenarioEventsDto: CreateScenarioEventsDto) {
    const { scenarioId, eventIds } = createScenarioEventsDto;

    if (eventIds.length === 0) {
      throw new BadRequestException('Event IDs array cannot be empty');
    }

    await this.scenarioService.getScenario(scenarioId);
    // Validate events exist
    const validEvents = await this.sessionEventService.findByIds(eventIds);
    const validEventIds = validEvents.map((e) => e.id);
    const invalidEventIds = eventIds.filter(
      (id) => !validEventIds.includes(id),
    );

    if (invalidEventIds.length > 0) {
      throw new BadRequestException(
        `Invalid event IDs: ${invalidEventIds.join(', ')}`,
      );
    }
    // Create an array of ScenarioEvents entities to be saved
    const scenarioEvents = eventIds.map((id) => ({
      scenarioId: scenarioId,
      eventId: id,
      tenantId: ExecutionManager.getTenantId(),
    }));

    // Save the scenario events to the database
    await this.dataSource.transaction(async (entityManager) => {
      const scenarioEventsRepo = entityManager.getRepository('ScenarioEvents');
      await scenarioEventsRepo.save(scenarioEvents);
    });

    return true;
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

    const endedAt = new Date();
    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt,
    });

    let callDuration;
    if (scenarioSession.startedAt) {
      callDuration = endedAt.getTime() - scenarioSession.startedAt.getTime();
    }

    this.getScenarioSessionSummaryFromAI(
      scenarioSessionId,
      scenarioSession.scenarioId,
      callDuration,
    );
    try {
      await this.livekitService.deleteRoom(scenarioSession.roomId);
    } catch (error) {
      this.logger.debug(
        `Failed to delete room: ${JSON.stringify(error.message)}`,
      );
    }

    return { message: 'Scenario session ended successfully' };
  }

  async getScenarioSessionSummaryFromAI(
    scenarioSessionId: string,
    scenarioId: number,
    callDuration?: number,
  ) {
    await this.dataSource.transaction(async (entityManager) => {
      const scenarioSessionMessagesRepo = entityManager.getRepository(
        ScenarioSessionMessages,
      );
      const scenarioSessionMessages = await scenarioSessionMessagesRepo.find({
        where: {
          scenarioSessionId,
          messageType: ScenarioSessionMessageType.TEXT,
          tenantId: ExecutionManager.getTenantId(),
        },
      });

      if (scenarioSessionMessages.length === 0) {
        this.logger.warn(
          `No scenario session messages found for scenario session ${scenarioSessionId}`,
        );
        return;
      }

      const messages = scenarioSessionMessages.map((message) => ({
        role: message.senderId > 0 ? 'COUNSELLOR' : 'CLIENT',
        content: message.content,
        start_time: message.startSeconds,
        end_time: message.endSeconds,
      }));

      const scenario = await this.scenarioService.getScenario(
        scenarioId,
        entityManager,
      );

      const summary = await this.aiService.getScenarioSessionSummary(
        messages,
        scenario.description,
      );

      const scenarioSessionDetailsRepo = entityManager.getRepository(
        ScenarioSessionDetails,
      );
      const scenarioSessionDetails = scenarioSessionDetailsRepo.create({
        scenarioSessionId,
        callDuration,
        summary: { feedback: summary },
        tenantId: ExecutionManager.getTenantId(),
      });
      await scenarioSessionDetailsRepo.save(scenarioSessionDetails);
    });
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

    const feedback = await this.scenarioSessionFeedbacksRepository.findOne({
      where: { scenarioSessionId },
    });

    if (feedback) {
      throw new BadRequestException(
        'Feedback already exists for this scenario session',
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

  async getScenarioSessionByRoomId(roomId: string) {
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: { roomId, tenantId: ExecutionManager.getTenantId() },
    });

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    return scenarioSession;
  }

  async addScenarioSessionMessage(
    scenarioSessionId: string,
    senderId: number,
    chatMessage: MessageRequest,
    tenantId: string,
  ) {
    const scenarioSessionMessage =
      this.scenarioSessionMessagesRepository.create({
        scenarioSessionId,
        senderId: chatMessage.role === 'CLIENT' ? -1 : senderId,
        content: chatMessage.content,
        messageType: ScenarioSessionMessageType.TEXT,
        startSeconds: chatMessage.start_time,
        endSeconds: chatMessage.end_time,
        tenantId,
      });
    return this.scenarioSessionMessagesRepository.save(scenarioSessionMessage);
  }

  async getMessagesByScenarioSessionId(
    scenarioSessionId: string,
    pagination: Pagination,
  ) {
    const messages =
      await this.scenarioSessionMessagesRepository.getMessagesByScenarioSessionId(
        scenarioSessionId,
        pagination,
      );

    return { messages };
  }

  async addScenarioSessionEvent(
    scenarioSessionId: string,
    event: LearnEventData,
    tenantId: string,
  ) {
    const scenarioSessionEvent = this.scenarioSessionEventsRepository.create({
      scenarioSessionId,
      eventId: event.event_id,
      occurredAt: event.timestamp,
      tenantId,
    });
    return this.scenarioSessionEventsRepository.save(scenarioSessionEvent);
  }
}
