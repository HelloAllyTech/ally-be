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
import { DataSource, In, Repository } from 'typeorm';
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
import { DeleteScenarioEventsDto } from '../dto/delete-scenario-events.dto';
import { ScenarioEvents } from '../entity/scenario-events.entity';
import { EntityOperationException } from 'src/exception/custom.exception';
import { UserRole } from 'src/common/constants/user.constants';
import { PermissionsService } from 'src/authorization/service/permissions.service';
import { Scenarios } from '../entity/scenarios.entity';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';

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
    @InjectRepository(ScenarioEvents)
    private scenarioEventsRepository: Repository<ScenarioEvents>,
    private permissionsService: PermissionsService,
  ) {
    this.logger = LoggerService.getInstance(ScenarioSessionService.name);
  }

  async getScenarioSessions(
    counselorId: number,
    options: Pagination,
    statuses?: string,
  ) {
    const scenarioSessions: ScenarioSessions[] =
      await this.scenarioSessionRepository.getScenarioSessions(
        counselorId,
        options,
        statuses ?? `${ScenarioSessionStatus.ENDED}`,
      );

    return { data: scenarioSessions };
  }

  async getAdminScenarioSessions(options: Pagination) {
    const scenarioSessions: ScenarioSessions[] =
      await this.scenarioSessionRepository.getAdminScenarioSessions(
        options,
        `${ScenarioSessionStatus.ENDED}`,
      );

    return { data: scenarioSessions };
  }

  async getScenarioSession(scenarioSessionId: string, counselorId: number) {
    const userRoles = await this.permissionsService.getUserRoles(counselorId);
    const scenarioSession =
      await this.scenarioSessionRepository.getScenarioSession(
        scenarioSessionId,
        counselorId,
        userRoles.includes(UserRole.ADMIN),
      );

    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }

    // Filter events to only include ACTIVE ones
    if ((scenarioSession as any).events) {
      (scenarioSession as any).events = (scenarioSession as any).events.filter(
        (event: any) =>
          event.events?.visibilityType === SessionEventVisibilityType.ACTIVE,
      );
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

    const roomMetadata = this.createRoomMetadata(scenario, sessionEvents);
    await this.livekitService.createRoom({
      name: `${scenarioSession.roomId}`,
      ttl: startScenarioSessionDto.ttl ?? 1800,
      metadata: roomMetadata,
    });

    const accessToken = await this.generateScenarioSessionToken(
      scenarioSession.roomId,
      counselorId,
    );

    return { scenarioSession, accessToken };
  }

  private createRoomMetadata(
    scenario: Scenarios,
    sessionEvents: SessionEvents[],
  ) {
    if (!scenario.metadata?.lifeHistory) {
      this.logger.error(
        `Scenario metadata lifeHistory is required for scenario ${scenario.id}`,
      );
      throw new BadRequestException(
        'Scenario details are not complete. Please contact admin.',
      );
    }

    const { lifeHistory, ...metadataWithoutLifeHistory } = scenario.metadata;
    scenario.metadata = JSON.parse(JSON.stringify(metadataWithoutLifeHistory));

    return {
      version: '1.0',
      tenantId: ExecutionManager.getTenantId(),
      scenario: {
        ...scenario,
        lifeHistory: JSON.parse(JSON.stringify(lifeHistory)),
        events: sessionEvents,
      },
    };
  }

  async mapEventsToScenario(createScenarioEventsDto: CreateScenarioEventsDto) {
    const { scenarioId, eventIds } = createScenarioEventsDto;

    if (eventIds.length === 0) {
      throw new BadRequestException('Event IDs array cannot be empty');
    }

    await this.scenarioService.getScenario(scenarioId);
    // Validate events exist
    const validEvents = await this.sessionEventService.findByIds(eventIds);
    const validIdsSet = new Set(validEvents.map((e) => e.id));
    const invalidEventIds = eventIds.filter((id) => !validIdsSet.has(id));
    if (invalidEventIds.length > 0) {
      throw new BadRequestException(`Invalid event IDs: ${invalidEventIds}`);
    }
    // Create an array of ScenarioEvents entities to be saved
    const scenarioEvents = eventIds.map((id) => ({
      scenarioId: scenarioId,
      eventId: id,
      tenantId: ExecutionManager.getTenantId(),
    }));

    // Save the scenario events to the database
    await this.scenarioEventsRepository.save(scenarioEvents);
    return scenarioEvents;
  }

  async deleteScenarioEvents(scenarioEvents: DeleteScenarioEventsDto) {
    const { scenarioId, eventIds } = scenarioEvents;
    if (eventIds.length === 0) {
      throw new BadRequestException('Event IDs array cannot be empty');
    }

    await this.scenarioService.getScenario(scenarioId);

    const result = await this.scenarioEventsRepository.delete({
      eventId: In(eventIds),
      scenarioId,
    });
    if (result.affected === 0) {
      throw new BadRequestException('No scenario events found to delete');
    }
    return result.affected;
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

    if (activeScenarioSessions.data.length > 0) {
      throw new EntityOperationException(
        `You already have an active scenario session ${activeScenarioSessions.data[0].id}`,
        activeScenarioSessions.data[0].id,
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
    const score = await this.calculateScenarioSessionScore(scenarioSessionId);

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt,
      score,
    });

    let callDuration = 0;
    if (scenarioSession.startedAt && scenarioSession.endedAt) {
      callDuration =
        endedAt.getTime() - scenarioSession.startedAt.getTime() || 0;
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

  private async calculateScenarioSessionScore(scenarioSessionId: string) {
    return this.scenarioSessionRepository.getScenarioSessionScore(
      scenarioSessionId,
    );
  }

  private async getScenarioSessionSummaryFromAI(
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
        ['id', 'title', 'description'],
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
      where: { roomId },
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
    scenarioSession: ScenarioSessions,
    event: LearnEventData,
  ) {
    await this.dataSource.transaction(async (entityManager) => {
      const scenarioSessionEventsRepo = entityManager.getRepository(
        ScenarioSessionEvents,
      );
      const scenarioSessionEvent = scenarioSessionEventsRepo.create({
        scenarioSessionId: scenarioSession.id,
        eventId: event.event_id,
        occurredAt: event.timestamp,
        tenantId: scenarioSession.tenantId,
      });
      const savedScenarioSessionEvent =
        await scenarioSessionEventsRepo.save(scenarioSessionEvent);

      if (scenarioSession.status === ScenarioSessionStatus.ENDED) {
        const eventRepo = entityManager.getRepository(SessionEvents);
        const sessionEvent = await eventRepo.findOne({
          where: {
            id: event.event_id,
          },
        });

        const scenrioSessionRepo =
          entityManager.getRepository(ScenarioSessions);
        await scenrioSessionRepo.update(scenarioSession.id, {
          score: () => `score + ${sessionEvent?.score ?? 0}`,
        });
      }
      return savedScenarioSessionEvent;
    });
  }
}
