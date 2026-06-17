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
import { ParticipantInfo_Kind } from '@livekit/protocol';
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
import { ScenarioSessionTurnMetrics } from '../entity/scenario-session-turn-metrics.entity';
import { LearnTurnMetricsData } from '../interface/learn-message.interface';
import { ScenarioSessionMessageTags } from '../entity/scenario-session-message-tags.entity';
import { ScenarioSessionTags } from '../entity/scenario-session-tags.entity';
import {
  MessageRequest,
  ScenarioEvaluationChatMessage,
} from 'src/ai/dto/ai.request.dto';
import { ScenarioEvaluationMessageTag } from 'src/ai/dto/ai.response.dto';
import {
  LearnBehaviorInstructionData,
  LearnEventData,
} from '../interface/learn-message.interface';
import { ScenarioSessionBehaviorInstructions } from '../entity/scenario-session-behavior-instructions.entity';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { EntityOperationException } from 'src/exception/custom.exception';
import { SimulationCapacityException } from '../exception/simulation-capacity.exception';
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
import { UserService } from 'src/user/service/user.service';
import {
  ChecklistItem,
  ExperienceMode,
  ScenarioStatus,
  StateNames,
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
import { ScenarioSessionReviewSharedService } from 'src/scenario-session-review/service/review-shared.service';
import {
  ScenarioSessionLeaderboardEvent,
  ScenarioSessionLeaderboardEndedEventParams,
} from '../type/scenario-session-leaderboard-event.type';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { CaseSessionService } from 'src/case/service/case-session.service';
import { CommonUtil } from 'src/common/util/common.util';
import { ScenarioSharedService } from './scenario-shared.service';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { ScenarioSessionSkillsResponseDto } from '../dto/scenario-session-skills-response.dto';
import { BehaviorTranslationRepository } from '../repository/behavior-translation.repository';
import { ScenarioBehaviorInstructionTranslationRepository } from '../repository/scenario-behavior-instruction-translation.repository';
import { ScenarioSessionEventChecklistResponseDto } from '../dto/scenario-session-event-checklist-response.dto';
import { ScenarioEventsRepository } from '../repository/scenario-events.repository';
import {
  ReflectionPromptItemDto,
  ScenarioSessionReflectionPromptsResponseDto,
} from '../dto/scenario-session-reflection-prompts-response.dto';
import { UpdateReflectionPromptResponseDto } from '../dto/reflection-prompts-request.dto';
import { ScenarioSessionReflectionPromptResponse } from '../entity/scenario-session-reflection-prompt-response.entity';
import { SCENARIO_SESSION_REFLECTION_PROMPTS } from '../constants/scenario-session-reflection-prompt.constants';
import { ScenariosRepository } from '../repository/scenario.repository';
import { getSessionDurationInSeconds } from 'src/review/util/review.util';
import { EndScenarioSessionRequestBodyDto } from '../dto/end-scenario-session-request-body.dto';
import { ScenarioSessionRecordingService } from './scenario-session-recording.service';
import { convertTimestampNsToDate } from 'src/common/util/date.util';
import { EgressInfo } from 'livekit-server-sdk';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';

/** Cache for preview room metadata (used when dispatching agent directly in local dev) */
const previewRoomMetadataCache = new Map<string, object>();

@Injectable()
export class ScenarioSessionService {
  private readonly logger: LoggerService;
  constructor(
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private scenarioService: ScenarioService,
    private scenarioSharedService: ScenarioSharedService,
    private livekitService: LiveKitService,
    private sessionEventSharedService: SessionEventSharedService,
    @InjectRepository(ScenarioSessionFeedbacks)
    private scenarioSessionFeedbacksRepository: Repository<ScenarioSessionFeedbacks>,
    @InjectRepository(ScenarioSessionReflectionPromptResponse)
    private scenarioSessionReflectionPromptResponseRepository: Repository<ScenarioSessionReflectionPromptResponse>,
    private dataSource: DataSource,
    private aiService: AiService,
    private scenarioTenantService: ScenarioTenantService,
    private scenarioPathSessionService: ScenarioPathSessionService,
    private permissionValidatorService: PermissionValidator,
    private simulationCreditsService: SimulationCreditsService,
    private configService: AppConfigService,
    private scenarioPathSharedService: ScenarioPathSharedService,
    private scenarioVoicesRepository: ScenarioVoicesRepository,
    private scenarioSessionReviewSharedService: ScenarioSessionReviewSharedService,
    private eventEmitter: EventEmitter2,
    private caseSharedService: CaseSharedService,
    private caseSessionService: CaseSessionService,
    @InjectRepository(ScenarioSessionBehaviorInstructions)
    private scenarioSessionBehaviorInstructionsRepository: Repository<ScenarioSessionBehaviorInstructions>,
    private behaviorTranslationRepository: BehaviorTranslationRepository,
    private scenarioBehaviorInstructionTranslationRepository: ScenarioBehaviorInstructionTranslationRepository,
    private scenarioEventsRepository: ScenarioEventsRepository,
    private scenariosRepository: ScenariosRepository,
    private scenarioSessionRecordingService: ScenarioSessionRecordingService,
    private sharedLanguageService: SharedLanguageService,
    private sessionEventTranslationService: SessionEventTranslationService,
    private userService: UserService,
  ) {
    this.logger = LoggerService.getInstance(ScenarioSessionService.name);
  }

  async getMessagesByScenarioSessionId(
    scenarioSessionId: string,
    pagination: Pagination,
    options?: { includeTags?: boolean },
  ) {
    return this.scenarioSharedService.getMessagesByScenarioSessionId(
      scenarioSessionId,
      pagination,
      options,
    );
  }

  async getScenarioSessionSkills(
    scenarioSessionId: string,
  ): Promise<ScenarioSessionSkillsResponseDto> {
    return this.scenarioSharedService.getScenarioSessionSkills(
      scenarioSessionId,
    );
  }

  async getReflectionPrompts(
    scenarioSessionId: string,
  ): Promise<ScenarioSessionReflectionPromptsResponseDto> {
    const tenantId = ExecutionManager.getTenantId();
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: {
        id: scenarioSessionId,
        tenantId,
      },
    });

    if (!scenarioSession) {
      throw new NotFoundException('Scenario session not found');
    }

    const reflectionPromptResult =
      await this.scenarioSessionReflectionPromptResponseRepository.find({
        where: { scenarioSessionId },
      });

    const reflectionPrompts: ReflectionPromptItemDto[] =
      reflectionPromptResult.map((reflectionPrompt) => ({
        id: reflectionPrompt.id,
        promptId: reflectionPrompt.promptId,
        prompt:
          SCENARIO_SESSION_REFLECTION_PROMPTS.get(reflectionPrompt.promptId) ??
          '',
        response: reflectionPrompt.response,
      }));

    return { reflectionPrompts };
  }

  async createReflectionPromptRecordsForSession(
    scenarioSessionId: string,
    tenantId: string,
  ): Promise<void> {
    const existing =
      await this.scenarioSessionReflectionPromptResponseRepository.find({
        where: { scenarioSessionId },
      });

    if (!existing.length) {
      const randomPrompts = this.pickRandomUniquePrompts(2);
      const toCreate = randomPrompts.map((prompt) =>
        this.scenarioSessionReflectionPromptResponseRepository.create({
          scenarioSessionId,
          promptId: prompt.promptId,
          response: undefined,
          tenantId,
        }),
      );
      await this.scenarioSessionReflectionPromptResponseRepository.save(
        toCreate,
      );
    }
  }

  private pickRandomUniquePrompts(count: number) {
    const prompts = Array.from(
      SCENARIO_SESSION_REFLECTION_PROMPTS.entries(),
    ).map(([promptId, prompt]) => ({ promptId, prompt }));
    const selected: { promptId: string; prompt: string }[] = [];
    const maxCount = Math.min(count, prompts.length);
    while (selected.length < maxCount) {
      const index = Math.floor(Math.random() * prompts.length);
      const [picked] = prompts.splice(index, 1);
      selected.push(picked);
    }
    return selected;
  }

  async updateReflectionPromptResponse(
    scenarioSessionId: string,
    reflectionPromptId: string,
    updateReflectionPrompt: UpdateReflectionPromptResponseDto,
  ): Promise<ScenarioSessionReflectionPromptResponse> {
    const tenantId = ExecutionManager.getTenantId();
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: {
        id: scenarioSessionId,
        tenantId,
      },
    });

    if (!scenarioSession) {
      throw new NotFoundException('Scenario session not found');
    }

    const reflectionPrompt =
      await this.scenarioSessionReflectionPromptResponseRepository.findOne({
        where: {
          id: reflectionPromptId,
          scenarioSessionId,
        },
      });

    if (!reflectionPrompt) {
      throw new NotFoundException(
        `No response found for prompt ${reflectionPromptId}`,
      );
    }

    reflectionPrompt.response = updateReflectionPrompt.response;
    return this.scenarioSessionReflectionPromptResponseRepository.save(
      reflectionPrompt,
    );
  }

  async getScenarioSessions(
    counselorId: number,
    options: Pagination,
    statuses?: string,
    languageCode?: string,
  ) {
    const scenarioSessions: ScenarioSessions[] =
      await this.scenarioSessionRepository.getScenarioSessions(
        counselorId,
        options,
        statuses ?? `${ScenarioSessionStatus.ENDED}`,
      );

    scenarioSessions.forEach((scenarioSession) => {
      if (
        languageCode &&
        (scenarioSession as any).scenario.translations &&
        (scenarioSession as any).scenario.translations[languageCode]
      ) {
        (scenarioSession as any).scenario.title =
          (scenarioSession as any).scenario.translations[languageCode].title ||
          (scenarioSession as any).scenario.title;
        (scenarioSession as any).scenario.description =
          (scenarioSession as any).scenario.translations[languageCode]
            .description || (scenarioSession as any).scenario.description;
      }
      delete (scenarioSession as any).scenario.prompt;
      delete (scenarioSession as any).scenario.metadata;
      delete (scenarioSession as any).scenario.translations;
    });

    return { data: scenarioSessions };
  }

  async getAdminScenarioSessions(options: Pagination, languageCode?: string) {
    const scenarioSessions: ScenarioSessions[] =
      await this.scenarioSessionRepository.getAdminScenarioSessions(
        options,
        `${ScenarioSessionStatus.ENDED}`,
      );

    scenarioSessions.forEach((scenarioSession) => {
      if (
        languageCode &&
        (scenarioSession as any).scenario.translations &&
        (scenarioSession as any).scenario.translations[languageCode]
      ) {
        (scenarioSession as any).scenario.title =
          (scenarioSession as any).scenario.translations[languageCode].title ||
          (scenarioSession as any).scenario.title;
        (scenarioSession as any).scenario.description =
          (scenarioSession as any).scenario.translations[languageCode]
            .description || (scenarioSession as any).scenario.description;
      }
      delete (scenarioSession as any).scenario.prompt;
      delete (scenarioSession as any).scenario.metadata;
      delete (scenarioSession as any).scenario.translations;
    });

    return { data: scenarioSessions };
  }

  async getScenarioSession(
    scenarioSessionId: string,
    counselorId: number,
    enableRecommendations = false,
    languageCode?: string,
  ) {
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

    if (scenarioSession.startedAt && scenarioSession.endedAt) {
      const callDuration = getSessionDurationInSeconds(
        scenarioSession.startedAt,
        scenarioSession.endedAt,
      );
      if ((scenarioSession as any).details) {
        (scenarioSession as any).details.callDuration = callDuration;
        if (!enableRecommendations) {
          (scenarioSession as any).details.summary.improvements =
            (scenarioSession as any).details.summary.improvements ??
            (scenarioSession as any).details.summary.areas_of_improvement?.map(
              (area: any) => area.improvement,
            );
          (scenarioSession as any).details.summary.areas_of_improvement =
            undefined;
        }
      }
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

    const sessionFeedback = feedback
      ? {
          rating: feedback.rating,
          feedback: feedback.feedback,
          tags: feedback.tags ?? [],
        }
      : null;

    const review =
      await this.scenarioSessionReviewSharedService.getReviewByScenarioSessionId(
        scenarioSessionId,
      );

    const scenario = (scenarioSession as any).scenario;
    if (scenario) {
      scenario.metadata = {
        experienceMode:
          scenario.metadata?.experienceMode ?? ExperienceMode.FEEDBACK,
        name: scenario.metadata?.name,
        enableFeedback: scenario.metadata?.enableFeedback ?? true,
      };
      if (languageCode && scenario.translations?.[languageCode]) {
        scenario.title =
          scenario.translations[languageCode].title || scenario.title;
        scenario.description =
          scenario.translations[languageCode].description ||
          scenario.description;
      }
      delete scenario.prompt;
      delete scenario.translations;
    }

    return {
      ...scenarioSession,
      hasFeedback,
      sessionFeedback,
      reviewId: review?.id,
      reviewNote: review?.note,
      reviewStatus: review?.status,
      reviewCreatedAt: review?.createdAt,
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

    if (isOtherLanguage) {
      await this.overlayBehaviorInstructionTranslations(scenario, languageId);
    }

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

    // Determine voiceId from scenario metadata languageVoices
    const voiceId = scenario?.metadata?.languageVoices?.[languageId];

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

      // Thinking Filler is gated to an email allowlist — resolve the counselor's
      // email and let createRoomMetadata strip the filler when not allowed.
      const counselor = await this.userService.get(counselorId);
      const thinkingFillerAllowed = this.configService.isThinkingFillerAllowed(
        counselor?.email,
      );

      // Prepare room metadata with events and dependencies
      const roomMetadata = await this.scenarioSharedService.createRoomMetadata({
        scenario,
        sessionEvents,
        languageDetails,
        previousMemory,
        thinkingFillerAllowed,
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

      // Preparing state instructions for simulation room, only if currentState is present for scenario
      const stateNames: StateNames[] = this.getStateNames(
        scenario?.metadata?.currentState,
        scenario?.metadata?.stateNames,
      );
      // Create LiveKit room
      await this.livekitService.createRoom({
        name: `${scenarioSession.roomId}`,
        ttl:
          startScenarioSessionDto.ttl ?? DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
        metadata: roomMetadata,
      });

      // Proactively dispatch the agent immediately so it can initialize during
      // the frontend's ringing-bell delay. The participant_joined webhook is still
      // the fallback: if the agent is already in the room it will skip dispatch.
      //
      // Pre-mark the room so the webhook handler skips re-dispatch even if the
      // agent hasn't appeared in listParticipants() yet (narrow race window).
      this.livekitService.preMarkProactiveDispatch(`${scenarioSession.roomId}`);
      this.livekitService
        .agentDispatch(
          `${scenarioSession.roomId}`,
          this.configService.livekit.agentName,
          JSON.stringify(roomMetadata),
        )
        .catch((err) => {
          // Clear the pre-mark so the participant_joined webhook can take over.
          // Otherwise the flag would block fallback dispatch until the 30s timeout.
          this.livekitService.clearProactiveDispatch(
            `${scenarioSession.roomId}`,
          );
          this.logger.warn(
            `Proactive agent dispatch failed, webhook fallback will handle it: ${err?.message}`,
          );
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
        showScoreMeter: scenario?.metadata?.showScoreMeter,
        stateNames,
        metadata: {
          name: scenario?.metadata?.name,
          title: scenario?.metadata?.title,
          age: scenario?.metadata?.age,
        },
      };
      return {
        scenarioSession,
        accessToken,
        scenario: mappedScenarioData,
      };
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

  private async validateGlobalSimulationCapacity(): Promise<void> {
    const maxConcurrent =
      this.configService.simulationConcurrency.maxConcurrentSimulations;
    const activeRooms = await this.livekitService.listRooms();
    if (activeRooms.length >= maxConcurrent) {
      throw new SimulationCapacityException(maxConcurrent);
    }
  }

  private async validateStartScenarioSession(
    counselorId: number,
    scenarioId: number,
    startScenarioSessionDto: StartScenarioSessionRequestDto,
  ) {
    await this.validateGlobalSimulationCapacity();

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

  private getEgressRecordingStartedAt(egressInfo?: EgressInfo) {
    const recordingStartedAtNs = egressInfo?.fileResults?.[0]?.startedAt;
    if (!recordingStartedAtNs) {
      return null;
    }
    return convertTimestampNsToDate(recordingStartedAtNs);
  }

  private async getUpdatedMetadataForScenarioSession(
    scenarioSession: ScenarioSessions,
    egressInfo?: EgressInfo,
  ): Promise<Record<string, any> | null> {
    const recordingStartedAt = this.getEgressRecordingStartedAt(egressInfo);

    if (!recordingStartedAt) {
      return null;
    }

    const scenarioSessionMetadata: Record<string, any> = {
      ...scenarioSession.metadata,
      recordingStartedAt,
    };

    return scenarioSessionMetadata;
  }

  private async updateTranscriptTimestamps(
    scenarioSession: ScenarioSessions,
    egressInfo?: EgressInfo,
  ) {
    const recordingStartedAt = this.getEgressRecordingStartedAt(egressInfo);

    if (!recordingStartedAt || !scenarioSession.startedAt) {
      return null;
    }

    const transcriptVariationOffset =
      (new Date(recordingStartedAt).getTime() -
        new Date(scenarioSession.startedAt).getTime()) /
      1000;
    await this.scenarioSessionMessagesRepository.updateTranscriptTimestamps(
      scenarioSession.id,
      scenarioSession.tenantId,
      transcriptVariationOffset,
    );
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
  async endScenarioSession(
    scenarioSessionId: string,
    counselorId: number,
    endScenarioSessionRequestBodyDto?: EndScenarioSessionRequestBodyDto,
  ) {
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

    // Mark as ENDED before deleting the room to prevent re-entry: deleteRoom
    // triggers a room_finished webhook which calls endScenarioSession again.
    // The webhook handler skips sessions already in ENDED status.
    await this.scenarioSessionRepository.update(scenarioSessionId, {
      status: ScenarioSessionStatus.ENDED,
    });
    this.logger.info(`Updated scenario ${scenarioSessionId} status to ENDED`);

    const egressInfo =
      await this.scenarioSessionRecordingService.stopScenarioSessionRecording(
        scenarioSessionId,
      );

    try {
      await this.livekitService.deleteRoom(scenarioSession.roomId);
    } catch (error) {
      this.logger.debug(
        `Failed to end session: ${JSON.stringify(error.message)}`,
      );
    }

    const startedAt = scenarioSession.startedAt ?? new Date();
    let endedAt = new Date();

    if (scenarioSession.endedAt) {
      endedAt = scenarioSession.endedAt;
    } else {
      const egressEndedAt =
        egressInfo?.fileResults?.[0]?.endedAt || egressInfo?.endedAt;
      endedAt = egressEndedAt
        ? convertTimestampNsToDate(egressEndedAt)
        : endedAt;
    }

    // Update transcript timestamps if recording started at is not in the metadata
    if (!scenarioSession?.metadata?.recordingStartedAt) {
      await this.updateTranscriptTimestamps(scenarioSession, egressInfo);
    }

    let callDuration = 0;
    if (startedAt && endedAt) {
      callDuration = endedAt.getTime() - startedAt.getTime() || 0;
    }

    // Consume credits first so metadata.creditsUsed reflects the actual charge.
    // If consumption fails (e.g. simulation-credits service blip), don't block
    // end-session bookkeeping — record creditsUsed=0 and continue so metadata,
    // reflection prompts and the AI summary still get persisted.
    let creditsUsed = 0;
    try {
      creditsUsed = await this.consumeSimulationCredits(
        scenarioSession.counselorId,
        callDuration,
      );
    } catch (err) {
      this.logger.error(
        `consumeSimulationCredits failed for session ${scenarioSessionId}; recording creditsUsed=0 and continuing: ${err?.message}`,
      );
    }

    const scenarioSessionMetadata =
      await this.getUpdatedMetadataForScenarioSession(
        scenarioSession,
        egressInfo,
      );

    const updatedMetadata: Record<string, any> = {
      ...(scenarioSessionMetadata ?? scenarioSession.metadata ?? {}),
      creditsUsed,
    };

    await this.scenarioSessionRepository.update(scenarioSessionId, {
      endedAt,
      startedAt,
      metadata: updatedMetadata,
    });

    await this.createReflectionPromptRecordsForSession(
      scenarioSessionId,
      scenarioSession.tenantId,
    );

    const caseSessionItemId = scenarioSession.caseSessionItemId;
    let previousMemory: string | null = null;
    let needMemory: boolean = false;
    if (caseSessionItemId) {
      needMemory = true;
      previousMemory =
        await this.caseSharedService.getPreviousCaseMemory(caseSessionItemId);
    }
    // Intentionally not awaited: summary generation can take minutes, so the
    // end-session response returns immediately and the client polls for the
    // result. The method persists its own success/failure row, so the only
    // thing left to guard here is an unexpected rejection.
    this.getScenarioSessionSummaryFromAI(
      scenarioSessionId,
      needMemory,
      callDuration,
      previousMemory,
      endScenarioSessionRequestBodyDto?.enableRecommendations,
    ).catch((error) => {
      this.logger.error(
        `getScenarioSessionSummaryFromAI rejected unexpectedly for ${scenarioSessionId}: ${JSON.stringify(error?.message)}`,
      );
    });

    return { message: 'Scenario session ended successfully' };
  }

  private async consumeSimulationCredits(
    userId: number,
    callDuration: number,
  ): Promise<number> {
    const callDurationInSeconds = callDuration / 1000;
    const secondsPerCredit =
      this.configService.simulationCredits.lifespanSecondsPerCredit ?? 60;

    // Calculate full credits and remaining seconds
    const fullCredits = Math.floor(callDurationInSeconds / secondsPerCredit);
    const remainingSeconds = callDurationInSeconds % secondsPerCredit;

    // If remaining seconds >= 30, charge 1 additional credit, otherwise 0
    const additionalCredit = remainingSeconds >= 30 ? 1 : 0;
    const totalCreditsToConsume = fullCredits + additionalCredit;

    if (totalCreditsToConsume <= 0) return 0;
    await this.simulationCreditsService.consumeCredits(
      userId,
      totalCreditsToConsume,
    );
    return totalCreditsToConsume;
  }

  private async getScenarioSessionSummaryFromAI(
    scenarioSessionId: string,
    needMemory: boolean,
    callDuration?: number,
    previousMemory?: string | null,
    enableRecommendations?: boolean,
  ) {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      this.logger.error(
        'getScenarioSessionSummaryFromAI: tenantId not found in execution context',
      );
      return;
    }

    let summary;
    try {
      const scenarioSessionMessages =
        await this.scenarioSessionMessagesRepository.find({
          where: {
            scenarioSessionId,
            messageType: ScenarioSessionMessageType.TEXT,
            tenantId,
          },
        });
      const callDurationInSeconds = callDuration ? callDuration / 1000 : 0;
      if (scenarioSessionMessages.length === 0) {
        this.logger.warn(
          `No scenario session messages found for scenario session ${scenarioSessionId}`,
        );
        summary = {
          errorMessage: 'Session has no messages. No summary generated.',
        };
      } else if (callDurationInSeconds < 30) {
        this.logger.warn(
          `Scenario session ${scenarioSessionId} is too short. No evaluation will be performed.`,
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
              undefined,
              enableRecommendations,
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
    } catch (error) {
      this.logger.error(
        `Failed to get scenario session summary from AI: ${JSON.stringify(error.message)}`,
      );
      // Persist an explicit failure so the polling client renders a clear
      // "summary failed" state instead of a completed session with no summary
      // (e.g. when the AI call times out at the 5-minute axios limit).
      summary = {
        errorMessage: 'Failed to generate summary. Please try again.',
      };
    }

    // Persist outside the AI try/catch so a row is ALWAYS written — whether the
    // summary succeeded, was skipped (no messages / too short), or failed.
    try {
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
        `Failed to persist scenario session details for ${scenarioSessionId}: ${JSON.stringify(error.message)}`,
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

    const feedbackExists =
      await this.scenarioSessionFeedbacksRepository.findOne({
        where: { scenarioSessionId },
      });

    if (feedbackExists) {
      await this.scenarioSessionFeedbacksRepository.update(feedbackExists.id, {
        rating: addFeedbackToScenarioSessionDto.rating,
        feedback: addFeedbackToScenarioSessionDto.feedback,
        tags: addFeedbackToScenarioSessionDto.tags ?? [],
      });
      return this.scenarioSessionFeedbacksRepository.findOne({
        where: { id: feedbackExists.id },
      }) as Promise<ScenarioSessionFeedbacks>;
    }

    const scenarioSessionFeedback =
      this.scenarioSessionFeedbacksRepository.create({
        scenarioSessionId,
        rating: addFeedbackToScenarioSessionDto.rating,
        feedback: addFeedbackToScenarioSessionDto.feedback,
        tenantId: ExecutionManager.getTenantId(),
        tags: addFeedbackToScenarioSessionDto.tags ?? [],
      });

    return this.scenarioSessionFeedbacksRepository.save(
      scenarioSessionFeedback,
    );
  }

  async getScenarioSessionByRoomIdOrNull(
    roomId: string,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionRepository.findOne({
      where: { roomId },
    });
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

  /**
   * Persist one per-turn latency sample into scenario_session_turn_metrics.
   * `occurredAt` is the agent-side turn timestamp; falls back to now() if absent.
   */
  async addTurnMetrics(
    scenarioSession: ScenarioSessions,
    metrics: LearnTurnMetricsData,
    occurredAt?: Date,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(ScenarioSessionTurnMetrics);
    const row = repo.create({
      scenarioSessionId: scenarioSession.id,
      tenantId: scenarioSession.tenantId,
      roomId: scenarioSession.roomId,
      turnIndex: metrics.turn_index,
      invocationId: metrics.invocation_id,
      responseLatencyMs: metrics.response_latency_ms,
      eouDelayMs: metrics.eou_delay_ms,
      llmTtftMs: metrics.llm_ttft_ms,
      ttsTtfbMs: metrics.tts_ttfb_ms,
      orchestrationMs: metrics.orchestration_ms,
      llmResponseMs: metrics.llm_response_ms,
      prosodyMs: metrics.prosody_ms,
      branchingMs: metrics.branching_ms,
      knowledgeRetrievalMs: metrics.knowledge_retrieval_ms,
      processEventsMs: metrics.process_events_ms,
      behaviorsMs: metrics.behaviors_ms,
      scenarioId: metrics.scenario_id ?? scenarioSession.scenarioId,
      language: metrics.language,
      llmModel: metrics.llm_model,
      env: metrics.env,
      responseChars: metrics.response_chars,
      eventsDetected: metrics.events_detected ?? 0,
      prosodySkipped: metrics.prosody_skipped ?? false,
      llmTimedOut: metrics.llm_timed_out ?? false,
      interrupted: metrics.interrupted ?? false,
      occurredAt: occurredAt ?? new Date(),
      metadata: metrics.metadata,
    });
    await repo.save(row);
  }

  async addScenarioSessionBehaviorInstruction(
    scenarioSession: ScenarioSessions,
    behaviorInstruction: LearnBehaviorInstructionData,
  ) {
    const record = this.scenarioSessionBehaviorInstructionsRepository.create({
      scenarioSessionId: scenarioSession.id,
      scenarioBehaviorInstructionId:
        behaviorInstruction.behavior_instruction_data.behaviorInstructionId,
      occurredAt: behaviorInstruction.timestamp,
    });
    await this.scenarioSessionBehaviorInstructionsRepository.save(record);
  }

  async previewScenario(
    previewScenarioDto: PreviewScenarioDto,
    userId: number,
  ) {
    const { scenarioId, languageId } = previewScenarioDto;

    const scenario = await this.scenarioService.getAdminScenario(scenarioId);

    await this.validatePreviewScenario(scenario);
    await this.validateGlobalSimulationCapacity();

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

    if (isOtherLanguage) {
      await this.overlayBehaviorInstructionTranslations(scenario, languageId);
    }

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

    // Determine voiceId from scenario metadata languageVoices
    const voiceId = scenario?.metadata?.languageVoices?.[languageId];

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

    // Preparing state instructions for simulation room, only if currentState is present for scenario
    const stateNames: StateNames[] = this.getStateNames(
      scenario?.metadata?.currentState,
      scenario?.metadata?.stateNames,
    );

    await this.livekitService.createRoom({
      name: roomName,
      metadata: roomMetadata,
    });

    // Cache metadata for direct dispatch (local dev when webhook unreachable)
    if (this.configService.allowDirectAgentDispatch) {
      previewRoomMetadataCache.set(roomName, roomMetadata);
    }

    // Proactively dispatch the agent so it can initialize during the frontend's
    // ringing-bell delay. Mirrors startScenarioSession; the existing
    // dispatchPreviewAgent endpoint and webhook fallback both stay as safety nets.
    this.livekitService.preMarkProactiveDispatch(roomName);
    this.livekitService
      .agentDispatch(
        roomName,
        this.configService.livekit.agentName,
        JSON.stringify(roomMetadata),
      )
      .catch((err) => {
        // Clear the pre-mark so dispatchPreviewAgent / webhook can take over.
        this.livekitService.clearProactiveDispatch(roomName);
        this.logger.warn(
          `Proactive agent dispatch for preview failed, fallback will handle it: ${err?.message}`,
        );
      });

    const accessToken = await this.livekitService.generateAccessToken({
      roomName,
      participantName: userId.toString(),
    });

    return {
      roomName,
      accessToken,
      scenario,
      checklistEvents,
      stateNames,
      useDirectAgentDispatch: this.configService.allowDirectAgentDispatch,
    };
  }

  /**
   * Dispatch agent to a preview room (local dev only).
   * Bypasses LiveKit webhook when ally-be is unreachable (e.g. localhost).
   *
   * Idempotent: previewScenario now dispatches proactively, so this endpoint
   * is mostly a safety net. If a proactive dispatch is already in flight or
   * the agent is already in the room, this no-ops.
   */
  async dispatchPreviewAgent(roomName: string): Promise<void> {
    if (!this.configService.allowDirectAgentDispatch) {
      throw new BadRequestException(
        'Direct agent dispatch is not enabled (production uses webhook)',
      );
    }
    if (!roomName.startsWith('preview-')) {
      throw new BadRequestException(
        'Only preview rooms can use direct agent dispatch',
      );
    }

    // Skip if proactive dispatch is still pending (narrow race window).
    if (this.livekitService.isProactiveDispatchPending(roomName)) {
      this.logger.debug(
        `Proactive dispatch already pending for ${roomName}, skipping direct dispatch`,
      );
      return;
    }

    // Skip if an agent has already joined.
    try {
      const participants = await this.livekitService.listParticipants(roomName);
      if (participants.some((p) => p.kind === ParticipantInfo_Kind.AGENT)) {
        this.logger.debug(
          `Agent already in room ${roomName}, skipping direct dispatch`,
        );
        return;
      }
    } catch (err) {
      // Proceed with dispatch as a fallback if the check fails — same pattern
      // as the participant_joined webhook handler.
      this.logger.warn(
        `listParticipants failed for ${roomName} during direct dispatch; proceeding: ${err?.message}`,
      );
    }

    const metadata = previewRoomMetadataCache.get(roomName);
    if (!metadata) {
      throw new NotFoundException(
        `Preview room ${roomName} not found or expired`,
      );
    }
    await this.livekitService.agentDispatch(
      roomName,
      this.configService.livekit.agentName,
      JSON.stringify(metadata),
    );
    this.logger.debug(`Dispatched agent to preview room: ${roomName}`);
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
    previewRoomMetadataCache.delete(roomName);
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

  private async overlayBehaviorInstructionTranslations(
    scenario: any,
    languageId: number,
  ): Promise<void> {
    if (!scenario.behaviorInstructions?.length) return;

    // const instructionIds = scenario.behaviorInstructions.map(
    //   (instruction: any) => instruction.id,
    // );
    // const instructionTranslations =
    //   await this.scenarioBehaviorInstructionTranslationRepository.getTranslationsForInstructions(
    //     instructionIds,
    //     languageId,
    //   );

    const behaviorIds = scenario.behaviorInstructions.flatMap(
      (instruction: any) =>
        instruction.behaviors.map((behavior: any) => behavior.id),
    );
    const behaviorTranslations =
      await this.behaviorTranslationRepository.getTranslationsForBehaviors(
        behaviorIds,
        languageId,
      );

    // const instructionTranslationMap = new Map(
    //   instructionTranslations.map((translation) => [
    //     translation.scenarioBehaviorInstructionId,
    //     translation,
    //   ]),
    // );
    const behaviorTranslationMap = new Map(
      behaviorTranslations.map((translation) => [
        translation.behaviorId,
        translation,
      ]),
    );

    scenario.behaviorInstructions = scenario.behaviorInstructions.map(
      (instruction: any) => ({
        ...instruction,
        behaviors: instruction.behaviors.map((behavior: any) => ({
          ...behavior,
          name: behaviorTranslationMap.get(behavior.id)?.name ?? behavior.name,
        })),
      }),
    );
  }

  async getScenarioSessionEventChecklist(
    scenarioSessionId: string,
    counselorId: number,
    options: Pagination,
    languageCode?: string,
  ): Promise<ScenarioSessionEventChecklistResponseDto> {
    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId },
    });

    if (!scenarioSession) {
      throw new NotFoundException('Scenario session not found');
    }

    const scenario = await this.scenariosRepository.findOne({
      where: { id: scenarioSession.scenarioId },
    });
    if (!scenario) {
      throw new NotFoundException('Scenario not found');
    }

    const experienceMode = scenario.metadata?.experienceMode;

    if (experienceMode !== ExperienceMode.CHECKLIST) {
      return { eventChecklist: [] };
    }

    const eventChecklist =
      await this.scenarioEventsRepository.getEventChecklist(
        scenarioSession.id,
        scenario.id,
        options,
      );

    let translatedEventMap = new Map();
    if (languageCode) {
      const languageDetails =
        await this.sharedLanguageService.getLanguageByLanguageCode(
          languageCode,
        );

      if (!languageDetails) {
        throw new BadRequestException('Language not found');
      }

      const scenarioTranslation =
        await this.sessionEventTranslationService.getSessionEventsTranslationsByScenarioId(
          scenarioSession.scenarioId,
          languageDetails.id,
        );

      translatedEventMap = new Map(
        scenarioTranslation.map((t) => [t.id, t.name]),
      );
    }

    const eventChecklistDto = eventChecklist.map((event) => ({
      id: event.eventId,
      name: translatedEventMap.get(event.eventId) ?? event?.events?.name,
      hasOccurred:
        Array.isArray(event.scenarioSessionEvent) &&
        event.scenarioSessionEvent.length > 0,
    }));

    return { eventChecklist: eventChecklistDto };
  }

  getStateNames(currentState?: boolean, stateNames?: StateNames[]) {
    if (currentState && stateNames?.length) {
      return stateNames.map((stateName: StateNames) => {
        return {
          name: stateName.name,
          stateId: stateName.stateId,
        };
      });
    }
    return [];
  }
}
