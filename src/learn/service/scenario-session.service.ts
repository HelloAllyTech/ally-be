import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import {
  DataSource,
  EntityManager,
  In,
  IsNull,
  Not,
  Repository,
} from 'typeorm';
import { ScenarioSessionFeedbacks } from '../entity/scenario-session-feedbacks.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ScenarioSessionMessageType } from '../enum/scenario-session-message.type.enum';
import { ScenarioSessionTagCategory } from '../enum/scenario-session-tag-category.enum';
import { AiService } from 'src/ai/service/ai.service';
import { ScenarioSessionDetails } from '../entity/scenario-session-details.entity';
import { ScenarioSessionEvents } from '../entity/scenario-session-events.entity';
import { ScenarioSessionMessageTags } from '../entity/scenario-session-message-tags.entity';
import { ScenarioSessionTags } from '../entity/scenario-session-tags.entity';
import {
  MessageRequest,
  ScenarioEvaluationChatMessage,
} from 'src/ai/dto/ai.request.dto';
import { ScenarioEvaluationMessageTag } from 'src/ai/dto/ai.response.dto';
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
import { SessionItemStatus } from 'src/common/type/common.type';
import { ScenarioPathSharedService } from 'src/scenario-path/service/scenario-path-shared.service';
import {
  ExecutionContextPropagation,
  WithExecutionContext,
} from 'src/common/decorator/execution.context.decorator';
import {
  getActiveScenarioMandatoryFields,
  isEnglishLanguage,
} from '../util/scenario.util';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { ReviewSharedService } from 'src/review/service/review-shared.service';
import {
  ScenarioSessionLeaderboardEvent,
  ScenarioSessionLeaderboardEndedEventParams,
} from '../type/scenario-session-leaderboard-event.type';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { CaseSessionService } from 'src/case/service/case-session.service';
import { CommonUtil } from 'src/common/util/common.util';
import { ScenarioSharedService } from './scenario-shared.service';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';

@Injectable()
export class ScenarioSessionService {
  private readonly logger: LoggerService;
  constructor(
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private scenarioService: ScenarioService,
    private livekitService: LiveKitService,
    private sessionEventSharedService: SessionEventSharedService,
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
    private scenarioVoicesRepository: ScenarioVoicesRepository,
    private reviewSharedService: ReviewSharedService,
    private eventEmitter: EventEmitter2,
    private caseSharedService: CaseSharedService,
    private caseSessionService: CaseSessionService,
    private scenarioSharedService: ScenarioSharedService,
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

    // Filter events to only include those with ACTIVE session events (null when
    // visibility is PASSIVE or event missing), then remove sensitive fields
    if ((scenarioSession as any).events) {
      (scenarioSession as any).events = (scenarioSession as any).events
        .filter((event: any) => event.events != null)
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

    const review =
      await this.reviewSharedService.getReviewByScenarioSessionId(
        scenarioSessionId,
      );

    return {
      ...scenarioSession,
      hasFeedback,
      reviewId: review?.id,
      reviewStatus: review?.status,
    };
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
      startScenarioSessionDto,
    );

    const languageId = startScenarioSessionDto?.languageId;

    const { enLanguageDetails, languageDetails } =
      await this.getLanguageDetailsForScenarioSession(languageId);

    // Get all session events for this scenario
    let sessionEvents = [];

    // Check if language is not English
    const isOtherLanguage =
      languageId &&
      languageDetails &&
      !isEnglishLanguage(
        languageId,
        languageDetails.value,
        enLanguageDetails?.id,
      );

    // If language is not English, get translated session events
    sessionEvents = isOtherLanguage
      ? await this.sessionEventSharedService.getSessionEventsTranslationsByScenarioId(
          startScenarioSessionDto.scenarioId,
          languageId,
        )
      : await this.sessionEventSharedService.getSessionEventsByScenarioId(
          startScenarioSessionDto.scenarioId,
        );

    // Update termination (Translated Version) event if language is not English
    if (
      isOtherLanguage &&
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

      // Fetch previous case memory if this is part of a case sequence
      let previousMemory: string | null = null;
      if (startScenarioSessionDto.caseSessionItemId) {
        previousMemory = await this.caseSharedService.getPreviousCaseMemory(
          startScenarioSessionDto.caseSessionItemId,
        );
      }

      // Prepare room metadata with events and dependencies
      const roomMetadata = await this.scenarioSharedService.createRoomMetadata({
        scenario,
        sessionEvents,
        languageDetails,
        previousMemory,
      });

      // Preparing checklist events for simulation room, only if CHECKLIST mode is enabled for scenario
      let checklistEvents: ChecklistItem[] = [];

      if (scenario?.metadata?.experienceMode === ExperienceMode.CHECKLIST) {
        checklistEvents = (sessionEvents ?? [])
          .filter(
            (event: SessionEvents & { checklistVisibilityStatus?: boolean }) =>
              event?.checklistVisibilityStatus,
          )
          .map(({ name, id, score, message }) => ({
            name,
            id,
            score,
            message,
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

  async updateScenarioSession(
    scenarioSessionId: string,
    updateScenarioSessionDto: Partial<ScenarioSessions>,
  ) {
    return this.scenarioSessionRepository.update(scenarioSessionId, {
      ...updateScenarioSessionDto,
      updatedAt: new Date(),
    });
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

  private async validateStartScenarioSession(
    counselorId: number,
    scenarioId: number,
    startScenarioSessionDto: StartScenarioSessionRequestDto,
  ) {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      throw new NotFoundException('TenantId not found');
    }
    if (startScenarioSessionDto.scenarioPathSessionItemId) {
      const scenarioPathSessionItem =
        await this.scenarioPathSharedService.getPermittedPathSessionItemBySessionItemId(
          startScenarioSessionDto.scenarioPathSessionItemId,
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
    } else if (startScenarioSessionDto.caseSessionItemId) {
      const caseSessionItem =
        await this.caseSharedService.getPermittedCaseSessionItemBySessionItemId(
          startScenarioSessionDto.caseSessionItemId,
        );

      if (!caseSessionItem) {
        throw new BadRequestException('Case session item not found');
      }
      if (caseSessionItem.status === SessionItemStatus.LOCKED) {
        throw new BadRequestException('Case session item is locked');
      }
      const caseSessionId = caseSessionItem.caseSessionId;
      const caseSession =
        await this.caseSharedService.getCaseSessionById(caseSessionId);
      const caseId = caseSession?.caseId;
      if (caseId) {
        const caseTenant = await this.caseSharedService.getCaseTenant(
          tenantId,
          caseId,
        );
        if (!caseTenant) {
          throw new BadRequestException(
            'Case is not available for your organization',
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
    const startedAt = scenarioSession.startedAt ?? new Date();
    const endedAt = scenarioSession.endedAt ?? new Date();
    if (startedAt && endedAt) {
      callDuration = endedAt.getTime() - startedAt.getTime() || 0;
    }
    if (scenarioSession.scenarioPathSessionItemId)
      await this.scenarioPathSessionService.handleEndScenarioPathSession({
        scenarioPathSessionItemId: scenarioSession.scenarioPathSessionItemId,
        score,
        callDuration,
      });
    else if (scenarioSession.caseSessionItemId) {
      await this.caseSessionService.handleEndCaseSession({
        caseSessionItemId: scenarioSession.caseSessionItemId,
        score,
        callDuration,
      });
    }

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      startedAt,
      endedAt,
      score,
      eventStatus: ScenarioSessionEventStatus.COMPLETED,
    });
    this.logger.info(
      `Updated scenario ${scenarioSessionId} eventStatus to COMPLETED`,
    );

    // Emit event for community leaderboard score update
    const durationMinutes = callDuration / (1000 * 60);
    if (durationMinutes > 0) {
      this.eventEmitter.emit(
        ScenarioSessionLeaderboardEvent.SCENARIO_SESSION_ENDED,
        {
          userId: scenarioSession.counselorId,
          tenantId: scenarioSession.tenantId,
          date: endedAt,
          durationMinutes,
        } as ScenarioSessionLeaderboardEndedEventParams,
      );
    }
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

    const startedAt = scenarioSession.startedAt ?? new Date();
    const endedAt = scenarioSession.endedAt ?? new Date();

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
      endedAt,
      startedAt,
    });
    this.logger.info(`Updated scenario ${scenarioSessionId} status to ENDED`);

    let callDuration = 0;
    if (startedAt && endedAt) {
      callDuration = endedAt.getTime() - startedAt.getTime() || 0;
    }
    const caseSessionItemId = scenarioSession.caseSessionItemId;
    let previousMemory: string | null = null;
    let needMemory: boolean = false;
    if (caseSessionItemId) {
      needMemory = true;
      previousMemory =
        await this.caseSharedService.getPreviousCaseMemory(caseSessionItemId);
    }
    try {
      this.getScenarioSessionSummaryFromAI(
        scenarioSessionId,
        needMemory,
        callDuration,
        previousMemory,
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
    needMemory: boolean,
    callDuration?: number,
    previousMemory?: string | null,
  ) {
    try {
      const tenantId = ExecutionManager.getTenantId();
      if (!tenantId) {
        this.logger.error(
          'getScenarioSessionSummaryFromAI: tenantId not found in execution context',
        );
        return;
      }

      const scenarioSessionMessages =
        await this.scenarioSessionMessagesRepository.find({
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
        const useEvaluation =
          this.configService.featureFlag.useScenarioSessionEvaluation;
        const messages: MessageRequest[] | ScenarioEvaluationChatMessage[] =
          scenarioSessionMessages.map((message) => ({
            role: message.senderId > 0 ? 'COUNSELOR' : 'CLIENT',
            content: message.content,
            start_time: message.startSeconds,
            end_time: message.endSeconds,
            ...(useEvaluation ? { id: message.id.toString() } : {}),
          }));

        const aiResult = useEvaluation
          ? await this.aiService.getScenarioSessionEvaluation(
              messages as ScenarioEvaluationChatMessage[],
              needMemory,
              previousMemory,
            )
          : await this.aiService.getScenarioSessionSummary(
              messages as MessageRequest[],
              needMemory,
              previousMemory,
            );

        if (useEvaluation && aiResult && 'emotional_movement' in aiResult) {
          const messageStartSecondsByMessageId = new Map(
            scenarioSessionMessages.map((m) => [m.id, m.startSeconds ?? 0]),
          );
          for (const item of aiResult.emotional_movement) {
            const messageId = parseInt(item.message_id, 10);
            item.start_time = messageStartSecondsByMessageId.get(messageId);
          }
        }

        if (useEvaluation && aiResult && 'message_tags' in aiResult) {
          await this.dataSource.transaction(async (entityManager) => {
            await this.persistMessageTags(
              entityManager,
              scenarioSessionId,
              tenantId,
              scenarioSessionMessages.map((m) => m.id),
              aiResult.message_tags,
            );
          });
        }

        const aiSummary = CommonUtil.convertToCamelCase(aiResult);
        summary = { feedback: aiSummary };
      }

      await this.dataSource.transaction(async (entityManager) => {
        const scenarioSessionDetailsRepo = entityManager.getRepository(
          ScenarioSessionDetails,
        );
        const scenarioSessionDetails = scenarioSessionDetailsRepo.create({
          scenarioSessionId,
          callDuration,
          summary,
          tenantId,
        });
        await scenarioSessionDetailsRepo.save(scenarioSessionDetails);
      });
    } catch (error) {
      this.logger.error(
        `Failed to get scenario session summary from AI: ${JSON.stringify(error.message)}`,
      );
    }
  }

  private async persistMessageTags(
    entityManager: EntityManager,
    scenarioSessionId: string,
    tenantId: string,
    validMessageIds: number[],
    messageTags: ScenarioEvaluationMessageTag[],
  ) {
    const messageIdsSet = new Set(validMessageIds);
    const tagsRepo = entityManager.getRepository(ScenarioSessionTags);
    const messageTagsRepo = entityManager.getRepository(
      ScenarioSessionMessageTags,
    );

    const uniqueLabels = new Set<string>();
    const desiredMappings: Array<{
      messageId: number;
      label: string;
      category: ScenarioSessionTagCategory;
    }> = [];

    for (const msgTag of messageTags) {
      const messageId = parseInt(msgTag.id, 10);
      if (Number.isNaN(messageId) || !messageIdsSet.has(messageId)) {
        continue;
      }
      const tags = msgTag.tags ?? [];
      for (const tag of tags) {
        const category = tag.category as ScenarioSessionTagCategory;
        if (
          !tag?.label ||
          !category ||
          !Object.values(ScenarioSessionTagCategory).includes(category)
        ) {
          continue;
        }
        uniqueLabels.add(tag.label);
        desiredMappings.push({ messageId, label: tag.label, category });
      }
    }

    if (uniqueLabels.size === 0) {
      return;
    }

    const existingTags = await tagsRepo.find({
      where: { label: In(Array.from(uniqueLabels)) },
    });
    const labelToTag = new Map<string, ScenarioSessionTags>();
    for (const t of existingTags) {
      labelToTag.set(t.label, t);
    }

    const missingLabels = Array.from(uniqueLabels).filter(
      (label) => !labelToTag.has(label),
    );
    if (missingLabels.length > 0) {
      const newTags = missingLabels.map((label) => tagsRepo.create({ label }));
      const saved = await tagsRepo.save(newTags);
      for (const t of saved) {
        labelToTag.set(t.label, t);
      }
    }

    const existingMappings = await messageTagsRepo.find({
      where: {
        scenarioSessionId,
        messageId: In(validMessageIds),
      },
      select: ['messageId', 'tagId'],
    });
    const existingKeySet = new Set(
      existingMappings.map((m) => `${m.messageId}-${m.tagId}`),
    );

    const tagsToInsert: Array<{
      scenarioSessionId: string;
      messageId: number;
      tagId: string;
      category: ScenarioSessionTagCategory;
      tenantId: string;
    }> = [];
    for (const m of desiredMappings) {
      const tagId = labelToTag.get(m.label)?.id;
      if (!tagId) continue;
      const key = `${m.messageId}-${tagId}`;
      if (!existingKeySet.has(key)) {
        existingKeySet.add(key);
        tagsToInsert.push({
          scenarioSessionId,
          messageId: m.messageId,
          tagId,
          category: m.category,
          tenantId,
        });
      }
    }

    if (tagsToInsert.length > 0) {
      const entities = messageTagsRepo.create(tagsToInsert);
      await messageTagsRepo.save(entities);
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
      languageId &&
      languageDetails &&
      !isEnglishLanguage(
        languageId,
        languageDetails.value,
        enLanguageDetails?.id,
      );

    // If language is not English, get translated session events
    const sessionEvents = isOtherLanguage
      ? await this.sessionEventSharedService.getSessionEventsTranslationsByScenarioId(
          scenarioId,
          languageId,
        )
      : await this.sessionEventSharedService.getSessionEventsByScenarioId(
          scenarioId,
        );

    // Update termination (Translated Version) event if language is not English
    if (
      isOtherLanguage &&
      scenario?.terminationEvents &&
      scenario?.terminationEvents?.length > 0
    ) {
      const terminationEvents = scenario?.terminationEvents?.map(
        (termEvent) => {
          const translatedTerminationEvent = sessionEvents.find(
            (event) => event.id === termEvent?.eventId,
          );
          if (translatedTerminationEvent)
            return {
              ...translatedTerminationEvent,
              eventId: translatedTerminationEvent?.id,
              autoTerminationStatus: true,
            };
          return termEvent;
        },
      );
      scenario.terminationEvents = terminationEvents;
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

    const roomMetadata = await this.scenarioSharedService.createRoomMetadata({
      scenario,
      sessionEvents,
      languageDetails,
    });
    const roomName = `preview-${scenarioId}-${v4()}`;

    // Preparing checklist events for simulation room, only if CHECKLIST mode is enabled for scenario
    let checklistEvents: ChecklistItem[] = [];

    if (scenario?.metadata?.experienceMode === ExperienceMode.CHECKLIST) {
      checklistEvents = (sessionEvents ?? [])
        .filter(
          (event: SessionEvents & { checklistVisibilityStatus?: boolean }) =>
            event?.checklistVisibilityStatus,
        )
        .map(({ name, id, score, message }) => ({
          name,
          id,
          score,
          message,
        }));
    }

    await this.livekitService.createRoom({
      name: roomName,
      metadata: roomMetadata,
    });

    const accessToken = await this.livekitService.generateAccessToken({
      roomName,
      participantName: userId.toString(),
    });

    return { roomName, accessToken, scenario, checklistEvents };
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

    const ACTIVE_SCENARIO_MANDATORY_FIELDS = getActiveScenarioMandatoryFields(
      this.configService.featureFlag.stateBasedScenarioInstructions,
    );
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

  async getTopScoredScenarioSessionByCaseSessionItemId(
    caseSessionItemId: string,
  ) {
    return this.scenarioSessionRepository.findOne({
      where: { caseSessionItemId, score: Not(IsNull()) },
      order: { score: 'DESC' },
    });
  }

  private async getLanguageDetailsForScenarioSession(
    languageId: number | undefined,
  ) {
    return this.scenarioSharedService.getLanguageDetailsForScenarioSession(
      languageId,
    );
  }
}
