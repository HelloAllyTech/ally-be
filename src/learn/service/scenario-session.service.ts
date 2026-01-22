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
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { PreviewScenarioDto } from '../dto/preview-scenario.dto';
import { v4 } from 'uuid';
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
  SCENARIO_SESSION_TRANSLATABLE_FIELDS,
  STT_LLM_PROVIDER_CONFIG,
} from '../constants/scenario-session.constants';
import { SimulationCreditsService } from './simulation-credits.service';
import { AppConfigService } from 'src/config/config.service';
import {
  ChecklistItem,
  ExperienceMode,
  ScenarioStatus,
} from '../type/scenario.type';
import { ScenarioTenantService } from './scenario-tenant.service';
import { ScenarioPathSessionService } from 'src/scenario-path/service/scenario-path-session.service';
import { SessionItemStatus } from 'src/scenario-path/type/scenario-path-session-items.type';
import { extractEventIds } from 'src/session-event/util/session-event.util';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';
import { MAX_COMBINATION_EVENT_DEPTH } from 'src/session-event/constants/event.constant';
import { GetAdminScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';
import { ScenarioTranslationsRepository } from '../repository/scenario-translations.repository';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';
import { LanguageCode } from '../type/scenario-language-voice.type';
import { getActiveScenarioMandatoryFields } from '../util/scenario.util';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { Languages } from 'src/language/entity/languages.entity';
import { ReviewSharedService } from 'src/review/service/review-shared.service';
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
    private scenarioTenantService: ScenarioTenantService,
    private scenarioPathSessionService: ScenarioPathSessionService,
    private permissionValidatorService: PermissionValidator,
    private simulationCreditsService: SimulationCreditsService,
    private configService: AppConfigService,
    private scenarioPathSharedService: ScenarioPathSharedService,
    private scenarioTranslationRepository: ScenarioTranslationsRepository,
    private sessionEventTranslationService: SessionEventTranslationService,
    private sharedLanguageService: SharedLanguageService,
    private scenarioVoicesRepository: ScenarioVoicesRepository,
    private reviewSharedService: ReviewSharedService,
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

    // Filter events to only include ACTIVE ones and non-termination events,
    // then remove sensitive fields from nested events
    if ((scenarioSession as any).events) {
      (scenarioSession as any).events = (scenarioSession as any).events
        .filter(
          (event: any) =>
            event.events?.visibilityType ===
              SessionEventVisibilityType.ACTIVE &&
            event.autoTerminationStatus === false,
        )
        .map((event: any) => {
          const sanitizedEvents = { ...event.events };
          delete sanitizedEvents.detectionData;
          delete sanitizedEvents.detectionConfig;
          delete sanitizedEvents.branchInstruction;
          delete sanitizedEvents.description;
          delete sanitizedEvents.detectionType;
          return { ...event, events: sanitizedEvents };
        });
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

    const languageId = startScenarioSessionDto?.languageId;

    const { enLanguageDetails, languageDetails } =
      await this.getLanguageDetailsForScenarioSession(languageId);

    // Get all session events for this scenario
    let sessionEvents = [];

    // Check if language is not English
    const isOtherLanguage =
      languageId && enLanguageDetails && languageId !== enLanguageDetails.id;

    // If language is not English, get translated session events
    sessionEvents = isOtherLanguage
      ? await this.sessionEventTranslationService.getSessionEventsTranslationsByScenarioId(
          startScenarioSessionDto.scenarioId,
          languageId,
        )
      : await this.sessionEventService.getSessionEventsByScenarioId(
          startScenarioSessionDto.scenarioId,
        );

    // Update termination (Translated Version) event if language is not English
    // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove this if check and persist the next
    if (isOtherLanguage && scenario?.terminationEvent?.eventId) {
      const translatedTerminationEvent = sessionEvents.find(
        (event) => event.id === scenario?.terminationEvent?.eventId,
      );

      if (translatedTerminationEvent) {
        scenario.terminationEvent = {
          ...translatedTerminationEvent,
          eventId: translatedTerminationEvent.id,
          autoTerminationStatus: true,
        };
      }
    }

    // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): remove feature flag
    if (
      isOtherLanguage &&
      this.configService?.featureFlag?.multipleTerminationEvents &&
      scenario?.terminationEvents &&
      scenario?.terminationEvents?.length > 0
    ) {
      const terminationEvents = scenario?.terminationEvents.map((termEvent) => {
        const translatedTerminationEvent = sessionEvents.find(
          (event) => event.id === termEvent?.eventId,
        );
        return {
          ...translatedTerminationEvent,
          eventId: translatedTerminationEvent?.id,
          autoTerminationStatus: true,
        };
      });
      scenario.terminationEvents = terminationEvents;
    }

    // Determine voiceId from scenario metadata languageVoices if languageId is provided or from metadata voiceId if languageId is not provided
    let voiceId = languageId
      ? scenario?.metadata?.languageVoices?.[languageId]
      : scenario?.metadata?.voiceId;

    // If voiceId is not found, get fallback voice for language and gender
    if (!voiceId && languageId) {
      const voiceDetails = await this.getFallbackVoiceForLanguageGender(
        languageId,
        scenario?.metadata?.gender,
      );
      voiceId = voiceDetails?.id;
    }

    if (!voiceId) {
      throw new BadRequestException('Voice not found');
    }

    // Update metadata with resolved voiceId
    if (scenario?.metadata) {
      scenario.metadata.voiceId = voiceId;
    }

    // Create start scenario session data
    const startScenarioSessionDtoData = {
      ...startScenarioSessionDto,
      scenarioPathSessionItemId:
        startScenarioSessionDto.scenarioPathSessionItemId,
      voiceId,
    };
    // Create scenario session record
    const scenarioSession =
      await this.scenarioSessionRepository.createScenarioSession(counselorId, {
        ...startScenarioSessionDtoData,
      });

    try {
      // To add language and languageId to scenario metadata
      if (scenario?.metadata) {
        scenario.metadata.language =
          languageDetails?.value ?? DEFAULT_LANGUAGE_CODE;

        scenario.metadata.languageId = languageId ?? enLanguageDetails?.id;

        // Added defaultLanguageId to metadata to avoid database calls and use it for translation checks in createRoomMetadata.
        scenario.metadata.defaultLanguageId = enLanguageDetails?.id;
      }

      // Prepare room metadata with events and dependencies
      const roomMetadata = await this.createRoomMetadata(
        scenario,
        sessionEvents,
        languageDetails,
      );

      // Preparing checklist events for simulation room, only if CHECKLIST mode is enabled for scenario
      let checklistEvents: ChecklistItem[] = [];

      if (scenario?.metadata?.experienceMode === ExperienceMode.CHECKLIST) {
        checklistEvents = (sessionEvents ?? [])
          .filter(
            (event: SessionEvents & { checklistVisibilityStatus?: boolean }) =>
              event?.checklistVisibilityStatus,
          )
          .map(({ name, id, score }) => ({
            name,
            id,
            score,
          }));
      }

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

      const mappedScenarioData = {
        id: scenario?.id,
        title: scenario?.title,
        description: scenario?.description,
        coverImageUrl: scenario?.coverImageUrl,
        coverVideoUrl: scenario?.coverVideoUrl,
        status: scenario?.status,
        difficultyLevel: scenario?.difficultyLevel,
        triggerWarnings: scenario?.triggerWarnings,
        experienceMode: scenario?.metadata?.experienceMode,
        checklistType: scenario?.metadata?.checklistType,
        timerMode: scenario?.metadata?.timerMode,
        maxTimeValue: scenario?.metadata?.maxTimeValue,
        checklistEvents,
        metadata: {
          name: scenario?.metadata?.name,
          title: scenario?.metadata?.title,
          age: scenario?.metadata?.age,
        },
      };
      return { scenarioSession, accessToken, scenario: mappedScenarioData };
    } catch (error) {
      // If room creation fails, clean up the session
      await this.scenarioSessionRepository.delete(scenarioSession.id);
      throw error;
    }
  }

  private async getFallbackVoiceForLanguageGender(
    languageId: number,
    gender: string,
  ) {
    const voiceDetails = await this.scenarioVoicesRepository.getFallbackVoice(
      languageId,
      gender,
    );
    return voiceDetails;
  }

  private async createRoomMetadata(
    scenario: GetAdminScenarioDto,
    sessionEvents: SessionEvents[],
    languageDetails?: Languages | null,
  ) {
    const {
      metadata,
      terminationEvent,
      terminationEvents,
      ...scenarioDataWithoutMetadata
    } = scenario;

    const { voiceId, promptData } = await this.getScenarioTranslationData(
      {
        ...metadata,
        title: scenario.title,
        description: scenario.description,
      },
      scenario.id,
    );

    const languageCode = metadata?.language as LanguageCode;

    const scenarioData = {
      ...scenarioDataWithoutMetadata,
      // Ensure we have values even if not translated
      title: promptData?.title || scenario.title,
      description: promptData?.description || scenario.description,
      promptData: promptData,
    };
    const scenarioVoice = await this.scenarioService.getScenarioVoice(voiceId);

    const triggerEvents = new Set<string>();
    const eventMap = new Map<string, SessionEvents>();

    // Add initial session events to the map
    sessionEvents.forEach((event) => {
      triggerEvents.add(event.id);
      eventMap.set(event.id, event);
    });

    // Add termination event ID to be fetched if needed
    const idsToProcess = new Set<string>();

    // FEATURE_CLEANUP(FEATURE_MULTIPLE_TERMINATION_EVENTS): Remove this check
    if (
      !this.configService?.featureFlag?.multipleTerminationEvents &&
      terminationEvent?.eventId &&
      !eventMap.has(terminationEvent.eventId)
    ) {
      triggerEvents.add(terminationEvent.eventId);
      idsToProcess.add(terminationEvent.eventId);
    } else if (
      this.configService?.featureFlag?.multipleTerminationEvents &&
      terminationEvents &&
      terminationEvents?.length > 0
    ) {
      terminationEvents.forEach((termEvent) => {
        if (termEvent?.eventId && !eventMap.has(termEvent.eventId)) {
          idsToProcess.add(termEvent.eventId);
        }
      });
    }

    // Extract all event IDs referenced in combination events (initial pass)
    sessionEvents.forEach((event) => {
      if (event.detectionType === SessionEventDetectionType.COMBINATION) {
        const detectionData = (event as any).data || event.detectionData;
        const dependentIds = extractEventIds(detectionData?.expression);
        dependentIds.forEach((id) => {
          if (!eventMap.has(id)) {
            idsToProcess.add(id);
          }
        });
      }
    });

    // Recursively fetch nested combination events with depth limiting
    let currentDepth = 0;
    while (
      idsToProcess.size > 0 &&
      currentDepth < MAX_COMBINATION_EVENT_DEPTH
    ) {
      const idsToFetch = Array.from(idsToProcess);
      idsToProcess.clear();

      const fetchedEvents =
        await this.sessionEventService.findByIds(idsToFetch);

      for (const event of fetchedEvents) {
        eventMap.set(event.id, event);

        // If the fetched event is also a combination, extract its dependencies
        if (event.detectionType === SessionEventDetectionType.COMBINATION) {
          const detectionData = event.detectionData;
          const childIds = extractEventIds(detectionData?.expression);
          childIds.forEach((id) => {
            if (!eventMap.has(id)) {
              idsToProcess.add(id);
            }
          });
        }
      }

      currentDepth++;
    }

    if (idsToProcess.size > 0 && currentDepth >= MAX_COMBINATION_EVENT_DEPTH) {
      this.logger.warn(
        `Maximum combination event depth (${MAX_COMBINATION_EVENT_DEPTH}) exceeded while resolving events`,
      );
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
          detectionData: undefined,
        };
      }

      return {
        ...event,
        detectionData: undefined,
        data: { ...detectionData },
      };
    });

    const autoTerminationEvent =
      terminationEvent?.autoTerminationStatus &&
      !this.configService.featureFlag.multipleTerminationEvents
        ? {
            id: terminationEvent?.eventId,
            terminationMessage: terminationEvent?.message,
          }
        : undefined;

    const autoTerminationEvents = this.configService.featureFlag
      .multipleTerminationEvents
      ? terminationEvents?.map((termEvent) => {
          return {
            id: termEvent?.eventId,
            terminationMessage: termEvent?.message,
          };
        })
      : undefined;

    return {
      version: '1.0',
      tenantId: ExecutionManager.getTenantId(),
      scenario: {
        ...scenarioData,
        voice: scenarioVoice,
        ...(metadata?.language && {
          languageCode: languageCode,
        }),
        // Use database provider configs if available and not empty
        ...(languageDetails?.sttProviderConfig &&
        Object.keys(languageDetails.sttProviderConfig).length > 0
          ? { stt: languageDetails.sttProviderConfig }
          : STT_LLM_PROVIDER_CONFIG),
        ...(languageDetails?.llmProviderConfig &&
        Object.keys(languageDetails.llmProviderConfig).length > 0
          ? { llm: languageDetails.llmProviderConfig }
          : STT_LLM_PROVIDER_CONFIG),
        events: allEvents,
        triggerEvents: Array.from(triggerEvents),
        autoTerminationEvent,
        autoTerminationEvents,
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
    const endedAt = scenarioSession.endedAt ?? new Date();
    if (scenarioSession.startedAt && endedAt) {
      callDuration =
        endedAt.getTime() - scenarioSession.startedAt.getTime() || 0;
    }
    if (scenarioSession.scenarioPathSessionItemId)
      await this.scenarioPathSessionService.handleEndScenarioPathSession({
        scenarioPathSessionItemId: scenarioSession.scenarioPathSessionItemId,
        score,
        callDuration,
      });

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt,
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

        let summary;
        if (scenarioSessionMessages.length === 0) {
          this.logger.warn(
            `No scenario session messages found for scenario session ${scenarioSessionId}`,
          );
          summary = {
            errorMessage: 'Session was too short. No summary generated.',
          };
        } else {
          const messages = scenarioSessionMessages.map((message) => ({
            role: message.senderId > 0 ? 'COUNSELLOR' : 'CLIENT',
            content: message.content,
            start_time: message.startSeconds,
            end_time: message.endSeconds,
          }));

          const aiSummary =
            await this.aiService.getScenarioSessionSummary(messages);

          summary = { feedback: aiSummary };
        }

        const scenarioSessionDetailsRepo = entityManager.getRepository(
          ScenarioSessionDetails,
        );
        const scenarioSessionDetails = scenarioSessionDetailsRepo.create({
          scenarioSessionId,
          callDuration,
          summary,
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
        autoTerminationStatus: event.event_data.autoTerminationStatus ?? false,
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
    const { scenarioId, languageId } = previewScenarioDto;

    const scenario = await this.scenarioService.getAdminScenario(scenarioId);

    await this.validatePreviewScenario(scenario);

    const { enLanguageDetails, languageDetails } =
      await this.getLanguageDetailsForScenarioSession(languageId);

    // Check if language is not English
    const isOtherLanguage =
      languageId && enLanguageDetails && languageId !== enLanguageDetails.id;

    // If language is not English, get translated session events
    const sessionEvents = isOtherLanguage
      ? await this.sessionEventTranslationService.getSessionEventsTranslationsByScenarioId(
          scenarioId,
          languageId,
        )
      : await this.sessionEventService.getSessionEventsByScenarioId(scenarioId);

    // Update termination (Translated Version) event if language is not English
    if (isOtherLanguage && scenario?.terminationEvent?.eventId) {
      const terminationEventId = scenario.terminationEvent.eventId;
      const translatedTerminationEvent = sessionEvents.find(
        (event) => event.id === terminationEventId,
      );

      if (translatedTerminationEvent) {
        scenario.terminationEvent = {
          ...translatedTerminationEvent,
          eventId: translatedTerminationEvent.id,
          autoTerminationStatus: true,
        };
      }
    }

    // Determine voiceId from scenario metadata languageVoices if languageId is provided or from metadata voiceId if languageId is not provided
    let voiceId = languageId
      ? scenario?.metadata?.languageVoices?.[languageId]
      : scenario?.metadata?.voiceId;

    // If languageId is provided and voiceId is not found, get fallback voice for language and gender
    if (!voiceId && languageId) {
      const voiceDetails = await this.getFallbackVoiceForLanguageGender(
        languageId,
        scenario?.metadata?.gender,
      );
      voiceId = voiceDetails?.id;
    }

    if (!voiceId) {
      throw new BadRequestException('Voice ID not found for scenario');
    }

    // To add voice, language and languageId to scenario metadata
    if (scenario?.metadata) {
      scenario.metadata.voiceId = voiceId;
      scenario.metadata.language =
        languageDetails?.value ?? DEFAULT_LANGUAGE_CODE;
      scenario.metadata.languageId = languageId ?? enLanguageDetails?.id;

      // Added defaultLanguageId to metadata to avoid database calls and use it for translation checks in createRoomMetadata.
      scenario.metadata.defaultLanguageId = enLanguageDetails?.id;
    }

    const roomMetadata = await this.createRoomMetadata(
      scenario,
      sessionEvents,
      languageDetails,
    );
    const roomName = `preview-${scenarioId}-${v4()}`;

    await this.livekitService.createRoom({
      name: roomName,
      metadata: roomMetadata,
    });

    const accessToken = await this.livekitService.generateAccessToken({
      roomName,
      participantName: userId.toString(),
    });

    return { roomName, accessToken, scenario };
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

    const ACTIVE_SCENARIO_MANDATORY_FIELDS = getActiveScenarioMandatoryFields();
    const missingFields = ACTIVE_SCENARIO_MANDATORY_FIELDS.filter(
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

  private async getScenarioTranslationData(metadata: any, scenarioId: number) {
    const { voiceId, languageId, language, defaultLanguageId, ...promptData } =
      metadata ?? {};

    // If language is English (by languageId), return original data
    const langIsEnglish = languageId === defaultLanguageId;

    if (langIsEnglish) {
      return {
        voiceId,
        promptData: {
          ...promptData,
          languageId,
          language,
        },
      };
    }

    // Fetch translation for non-English language
    const translations = await this.scenarioTranslationRepository.findOne({
      select: ['id', 'metadata'],
      where: { scenarioId, languageId },
    });

    if (!translations?.metadata) {
      return { voiceId, promptData };
    }

    // Accept either object or JSON-string metadata
    let translationMetadata: Record<string, any> = {};
    if (typeof translations.metadata === 'string') {
      try {
        translationMetadata = JSON.parse(translations.metadata);
      } catch {
        // malformed JSON — skip applying translation (or log if desired)
        translationMetadata = {};
      }
    } else if (typeof translations.metadata === 'object') {
      translationMetadata = translations.metadata;
    }

    // Apply only the translatable fields if present
    for (const field of SCENARIO_SESSION_TRANSLATABLE_FIELDS) {
      if (
        Object.prototype.hasOwnProperty.call(translationMetadata, field) &&
        translationMetadata[field] != null &&
        translationMetadata[field] !== ''
      ) {
        promptData[field] = translationMetadata[field];
      }
    }

    return {
      voiceId,
      promptData: {
        ...promptData,
        languageId,
        language,
      },
    };
  }

  private async getLanguageDetailsForScenarioSession(
    languageId: number | undefined,
  ) {
    const enLanguageDetails =
      await this.sharedLanguageService.getLanguageByLanguageCode(
        DEFAULT_LANGUAGE_CODE,
      );

    if (!languageId) {
      return {
        enLanguageDetails: enLanguageDetails,
        languageDetails: null,
      };
    }

    const languageDetails = await this.sharedLanguageService.getLanguagesByIds([
      languageId,
    ]);

    return {
      enLanguageDetails: enLanguageDetails,
      languageDetails:
        languageDetails && languageDetails.length > 0
          ? languageDetails[0]
          : null,
    };
  }
}
