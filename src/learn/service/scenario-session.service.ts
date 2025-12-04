import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { ScenarioService } from './scenario.service';
import {
  ScenarioSessionEventStatus,
  ScenarioSessionStatus,
} from '../enum/scenario-session-status.enum';
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
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { EntityOperationException } from 'src/exception/custom.exception';
import { Scenarios } from '../entity/scenarios.entity';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { SessionEventVisibilityType } from 'src/session-event/enum/session-event-visibility-type.enum';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PreviewScenarioDto } from '../dto/preview-scenario.dto';
import { v4 } from 'uuid';
import { DEFAULT_SCENARIO_SESSION_TTL_SECONDS } from '../constants/scenario-session.constants';
import { SimulationCreditsService } from './simulation-credits.service';
import { AppConfigService } from 'src/config/config.service';
import { SCENARIO_MANDATORY_FIELDS } from '../constants/scenario-mandatory-fields.constants';
import { ScenarioStatus } from '../enum/scenario.status.enum';
import { ScenarioTenantService } from './scenario-tenant.service';
import { ScenarioPathSessionService } from 'src/scenario-path/service/scenario-path-session.service';
import { SessionItemStatus } from 'src/scenario-path/type/scenario-path-session-items.type';
import { extractEventIds } from 'src/session-event/util/session-event.util';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';
import { GetAdminScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';

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
    private scenarioTenantService: ScenarioTenantService,
    private scenarioPathSessionService: ScenarioPathSessionService,
    private permissionValidatorService: PermissionValidator,
    private simulationCreditsService: SimulationCreditsService,
    private configService: AppConfigService,
    private scenarioPathSharedService: ScenarioPathSharedService,
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
    const hasAdminAccess =
      await this.permissionValidatorService.validatePermissions(counselorId, [
        PERMISSIONS.ORGANIZATION_ACCESS,
      ]);
    const scenarioSession =
      await this.scenarioSessionRepository.getScenarioSession(
        scenarioSessionId,
        counselorId,
        hasAdminAccess,
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
    // Validate and get scenario
    const scenario = await this.scenarioService.getAdminScenario(
      startScenarioSessionDto.scenarioId,
    );
    if (!scenario) {
      throw new BadRequestException('Scenario not found');
    }
    await this.validateStartScenarioSession(
      counselorId,
      scenario.id,
      startScenarioSessionDto.scenarioPathSessionItemId,
    );

    // Get all session events for this scenario
    const sessionEvents =
      await this.sessionEventService.getSessionEventsByScenarioId(
        startScenarioSessionDto.scenarioId,
      );

    // Create scenario session record
    const scenarioSession =
      await this.scenarioSessionRepository.createScenarioSession(counselorId, {
        ...startScenarioSessionDto,
        scenarioPathSessionItemId:
          startScenarioSessionDto.scenarioPathSessionItemId,
      });

    try {
      // Prepare room metadata with events and dependencies
      const roomMetadata = await this.createRoomMetadata(
        scenario,
        sessionEvents,
      );

      // Create LiveKit room
      await this.livekitService.createRoom({
        name: `${scenarioSession.roomId}`,
        ttl:
          startScenarioSessionDto.ttl ?? DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
        metadata: roomMetadata,
      });

      // Generate access token for the user
      const accessToken = await this.generateScenarioSessionToken(
        scenarioSession.roomId,
        counselorId,
      );

      return { scenarioSession, accessToken };
    } catch (error) {
      // If room creation fails, clean up the session
      await this.scenarioSessionRepository.delete(scenarioSession.id);
      throw error;
    }
  }

  private async createRoomMetadata(
    scenario: GetAdminScenarioDto,
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

    const { metadata, terminationEvent, ...scenarioDataWithoutMetadata } =
      scenario;
    const { voiceId, ...promptData } = metadata;

    const scenarioData = {
      ...scenarioDataWithoutMetadata,
      promptData,
    };

    const scenarioVoice = await this.scenarioService.getScenarioVoice(voiceId);

    // triggerEvents: IDs from sessionEvents and termination event
    const triggerEvents = sessionEvents.map((event) => event.id);
    if (terminationEvent?.eventId) {
      triggerEvents.push(terminationEvent.eventId);
    }

    // Build a map of existing events for quick lookup
    const eventMap = new Map(sessionEvents.map((event) => [event.id, event]));
    const referencedEventIds = new Set<string>();

    // Extract all event IDs referenced in combination events
    sessionEvents.forEach((event) => {
      if (event.detectionType === SessionEventDetectionType.COMBINATION) {
        const detectionData = (event as any).data || event.detectionData;
        const dependentIds = extractEventIds(detectionData?.expression);
        dependentIds.forEach((id) => {
          if (!eventMap.has(id)) {
            referencedEventIds.add(id);
          }
        });
      }
    });

    // Add termination event ID to referenced events if it exists and is not already included
    if (terminationEvent?.eventId) {
      referencedEventIds.add(terminationEvent.eventId);
    }

    // Fetch any missing events (referenced in combinations or termination event)
    if (referencedEventIds.size > 0) {
      const missingEvents = await this.sessionEventService.findByIds(
        Array.from(referencedEventIds),
      );
      missingEvents.forEach((event) => eventMap.set(event.id, event));
    }

    // Enhance all events with dependentEvents for combination events
    const allEvents = Array.from(eventMap.values()).map((event) => {
      const detectionData = (event as any).data || event.detectionData;
      if (event.detectionType === SessionEventDetectionType.COMBINATION) {
        const detectionData = (event as any).data || event.detectionData;
        const dependentEvents = extractEventIds(detectionData?.expression);

        return {
          ...event,
          data: {
            ...detectionData,
            dependentEvents,
          },
        };
      }

      return {
        ...event,
        detectionData: undefined,
        data: { ...detectionData },
      };
    });

    const autoTerminationEvent = terminationEvent?.autoTerminationStatus
      ? {
          id: terminationEvent?.eventId,
          terminationMessage: terminationEvent?.message,
        }
      : undefined;

    return {
      version: '1.0',
      tenantId: ExecutionManager.getTenantId(),
      scenario: {
        ...scenarioData,
        voice: scenarioVoice,
        events: allEvents,
        triggerEvents,
        autoTerminationEvent,
      },
    };
  }

  private async validateStartScenarioSession(
    counselorId: number,
    scenarioId: number,
    scenarioPathSessionItemId?: string,
  ) {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new NotFoundException('TenantId not found');
    }
    if (scenarioPathSessionItemId) {
      const scenarioPathSessionItem =
        await this.scenarioPathSharedService.getPermittedPathSessionItemBySessionItemId(
          scenarioPathSessionItemId,
        );
      if (!scenarioPathSessionItem) {
        throw new BadRequestException('Scenario path session item not found');
      }
      if (scenarioPathSessionItem.status === SessionItemStatus.LOCKED) {
        throw new BadRequestException('Scenario path session item is locked');
      }
      const scenarioPathSessionId =
        scenarioPathSessionItem.scenarioPathSessionId;
      const scenarioPathSession =
        await this.scenarioPathSharedService.getScenarioPathSessionById(
          scenarioPathSessionId,
        );
      const scenarioPathId = scenarioPathSession?.scenarioPathId;
      if (scenarioPathId) {
        const scenarioPathTenant =
          await this.scenarioPathSharedService.getScenarioPathTenant(
            tenantId,
            scenarioPathId,
          );
        if (!scenarioPathTenant) {
          throw new BadRequestException(
            'Scenario is not available for your organization',
          );
        }
      }
    } else {
      const scenarioTenant = await this.scenarioTenantService.getScenarioTenant(
        tenantId,
        scenarioId,
      );
      if (!scenarioTenant) {
        throw new BadRequestException(
          'Scenario is not available for your organization',
        );
      }
    }
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
    const credits =
      await this.simulationCreditsService.getSimulationCredits(counselorId);
    const lifespanSecondsPerCredit =
      this.configService.simulationCredits.lifespanSecondsPerCredit ?? 60;
    if (
      credits.consumedCredits +
        DEFAULT_SCENARIO_SESSION_TTL_SECONDS / lifespanSecondsPerCredit >
      credits.creditLimit
    ) {
      throw new BadRequestException(
        'You have insufficient credits to start a new scenario session',
      );
    }
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async handleEndScenarioSessionEvent(
    scenarioSession: ScenarioSessions,
    event: LearnEventData,
  ) {
    if (!ExecutionManager.getTenantId()) {
      ExecutionManager.setAuthContext(
        scenarioSession.counselorId.toString(),
        scenarioSession.tenantId,
      );
    }

    const scenarioSessionId = scenarioSession?.id;

    const score = event.event_data.totalScore;

    let callDuration = 0;
    if (scenarioSession.startedAt && scenarioSession.endedAt) {
      callDuration =
        scenarioSession.endedAt.getTime() -
          scenarioSession.startedAt.getTime() || 0;
    }
    if (scenarioSession.scenarioPathSessionItemId)
      await this.scenarioPathSessionService.handleEndScenarioPathSession({
        scenarioPathSessionItemId: scenarioSession.scenarioPathSessionItemId,
        score,
        callDuration,
      });

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt: scenarioSession?.endedAt ?? new Date(),
      score,
      eventStatus: ScenarioSessionEventStatus.COMPLETED,
    });
    this.logger.info(
      `Updated scenario ${scenarioSessionId} eventStatus to COMPLETED`,
    );
  }

  @WithExecutionContext(ExecutionContextPropagation.SUPPORTS)
  async endScenarioSession(scenarioSessionId: string, counselorId: number) {
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: {
        id: scenarioSessionId,
        counselorId,
      },
    });
    if (!scenarioSession) {
      throw new BadRequestException('Scenario session not found');
    }
    if (!ExecutionManager.getTenantId()) {
      ExecutionManager.setAuthContext(
        counselorId.toString(),
        scenarioSession.tenantId,
      );
    }

    const endedAt = scenarioSession.endedAt ?? new Date();

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt,
    });
    this.logger.info(`Updated scenario ${scenarioSessionId} status to ENDED`);

    let callDuration = 0;
    if (scenarioSession.startedAt && endedAt) {
      callDuration =
        endedAt.getTime() - scenarioSession.startedAt.getTime() || 0;
    }
    try {
      this.getScenarioSessionSummaryFromAI(
        scenarioSessionId,
        scenarioSession.scenarioId,
        callDuration,
      );

      await this.livekitService.deleteRoom(scenarioSession.roomId);
    } catch (error) {
      this.logger.debug(
        `Failed to end session: ${JSON.stringify(error.message)}`,
      );
    }

    await this.consumeSimulationCredits(
      scenarioSession.counselorId,
      callDuration,
    );

    return { message: 'Scenario session ended successfully' };
  }

  private async consumeSimulationCredits(userId: number, callDuration: number) {
    const callDurationInSeconds = callDuration / 1000;
    const secondsPerCredit =
      this.configService.simulationCredits.lifespanSecondsPerCredit ?? 60;

    // Calculate full credits and remaining seconds
    const fullCredits = Math.floor(callDurationInSeconds / secondsPerCredit);
    const remainingSeconds = callDurationInSeconds % secondsPerCredit;

    // If remaining seconds >= 30, charge 1 additional credit, otherwise 0
    const additionalCredit = remainingSeconds >= 30 ? 1 : 0;
    const totalCreditsToConsume = fullCredits + additionalCredit;

    if (totalCreditsToConsume <= 0) return;
    await this.simulationCreditsService.consumeCredits(
      userId,
      totalCreditsToConsume,
    );
  }

  private async getScenarioSessionSummaryFromAI(
    scenarioSessionId: string,
    scenarioId: number,
    callDuration?: number,
  ) {
    try {
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
          ['id', 'metadata'],
          entityManager,
        );

        const summary = await this.aiService.getScenarioSessionSummary(
          messages,
          scenario.metadata?.agentGoal ?? '',
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
    } catch (error) {
      this.logger.error(
        `Failed to get scenario session summary from AI: ${JSON.stringify(error.message)}`,
      );
    }
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

  async handleScenarioSessionEvent(
    scenarioSession: ScenarioSessions,
    event: LearnEventData,
  ) {
    switch (event.event_data.id) {
      case 'end-of-session':
        await this.handleEndScenarioSessionEvent(scenarioSession, event);
        break;
      default:
        await this.addScenarioSessionEvent(scenarioSession, event);
        break;
    }
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
        eventId: event.event_data.id,
        occurredAt: event.timestamp,
        tenantId: scenarioSession.tenantId,
        score: event.event_data.score,
        emoji: event.event_data.emoji,
        message: event.event_data.message,
      });
      const savedScenarioSessionEvent =
        await scenarioSessionEventsRepo.save(scenarioSessionEvent);

      return savedScenarioSessionEvent;
    });

    if (event.event_data.autoTerminationStatus) {
      await this.endScenarioSession(
        scenarioSession.id,
        scenarioSession.counselorId,
      );
    }
  }

  async previewScenario(
    previewScenarioDto: PreviewScenarioDto,
    userId: number,
  ) {
    const { scenarioId } = previewScenarioDto;
    const scenario = await this.scenarioService.getAdminScenario(scenarioId);

    await this.validatePreviewScenario(scenario);

    const sessionEvents =
      await this.sessionEventService.getSessionEventsByScenarioId(scenarioId);

    const roomMetadata = await this.createRoomMetadata(scenario, sessionEvents);
    const roomName = `preview-${scenarioId}-${v4()}`;

    await this.livekitService.createRoom({
      name: roomName,
      metadata: roomMetadata,
    });

    const accessToken = await this.livekitService.generateAccessToken({
      roomName,
      participantName: userId.toString(),
    });

    return { roomName, accessToken };
  }

  private async validatePreviewScenario(scenario: Scenarios) {
    if (
      ![ScenarioStatus.DRAFT, ScenarioStatus.ACTIVE].includes(scenario.status)
    ) {
      throw new BadRequestException(
        'Scenario should be draft or active for preview',
      );
    }

    const { metadata, ...scenarioDataWithoutMetadata } = scenario;
    const flatScenario = {
      ...scenarioDataWithoutMetadata,
      ...(metadata ?? {}),
    };

    const missingFields = SCENARIO_MANDATORY_FIELDS.filter(
      (field) => !flatScenario[field as keyof typeof flatScenario],
    );
    if (missingFields.length > 0) {
      throw new BadRequestException(
        `The following required fields are missing for preview scenario: ${missingFields.join(', ')}`,
      );
    }
  }

  async endPreviewScenario(roomName: string) {
    await this.livekitService.deleteRoom(roomName);
    this.logger.info(`Preview scenario room deleted: ${roomName}`);
  }

  async getLatestScenarioSessionByScenarioPathSessionItemId(
    scenarioPathSessionItemId: string,
  ) {
    return this.scenarioSessionRepository.findOne({
      where: { scenarioPathSessionItemId },
      order: { createdAt: 'DESC' },
    });
  }
}
