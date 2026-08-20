import { CohortVisibilityService } from 'src/cohort/service/cohort-visibility.service';
import { CohortContentType } from 'src/cohort/constants/cohort.constants';
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
import {
  ScenarioSessionLifecycleEvent,
  ScenarioSessionLifecycleEventType,
} from '../entity/scenario-session-lifecycle-event.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { ScenarioSessionMessageType } from '../enum/scenario-session-message.type.enum';
import { ScenarioSessionTagCategory } from '../enum/scenario-session-tag-category.enum';
import { AiService } from 'src/ai/service/ai.service';
import { ScenarioSessionEvaluationService } from './scenario-session-evaluation.service';
import { GlossaryAdherenceService } from 'src/language/service/glossary-adherence.service';
import { ScenarioSessionDetails } from '../entity/scenario-session-details.entity';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';
import { ScenarioSessionEvents } from '../entity/scenario-session-events.entity';
import { ScenarioSessionTurnMetrics } from '../entity/scenario-session-turn-metrics.entity';
import { ScenarioSessionStartMetrics } from '../entity/scenario-session-start-metrics.entity';
import {
  LearnSessionMemoryData,
  LearnStartMetricsData,
  LearnTurnMetricsData,
} from '../interface/learn-message.interface';
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
import {
  ChecklistItem,
  ExperienceMode,
  FeedbackTabsConfig,
  ScenarioStatus,
  StateNames,
  feedbackTabsNeedEvaluation,
  resolveFeedbackTabs,
} from '../type/scenario.type';
import { User } from 'src/user/entity/user.entity';
import { WorkerType, resolveWorkerType } from 'src/user/enum/user.enum';
import { LearnerSupervisorMemoryService } from './learner-supervisor-memory.service';
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
  shouldServeMultilingual,
} from '../util/scenario.util';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { ScenarioSessionReviewSharedService } from 'src/scenario-session-review/service/review-shared.service';
import {
  ScenarioSessionLeaderboardEvent,
  ScenarioSessionLeaderboardEndedEventParams,
} from '../type/scenario-session-leaderboard-event.type';
import { CaseSharedService } from 'src/case/service/case-shared.service';
import { CaseSessionService } from 'src/case/service/case-session.service';
import { TrackProgressService } from 'src/track/service/track-progress.service';
import { TrackMemoryService } from 'src/track/service/track-memory.service';
import { CommonUtil } from 'src/common/util/common.util';
import { ScenarioSharedService } from './scenario-shared.service';
import { RoomMetadataStoreService } from './room-metadata-store.service';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { ScenarioSessionSkillsResponseDto } from '../dto/scenario-session-skills-response.dto';
import { BehaviorTranslationRepository } from '../repository/behavior-translation.repository';
import { ScenarioBehaviorInstructionTranslationRepository } from '../repository/scenario-behavior-instruction-translation.repository';
import { ScenarioSessionEventChecklistResponseDto } from '../dto/scenario-session-event-checklist-response.dto';
import { ScenarioEventsRepository } from '../repository/scenario-events.repository';
import { ScenariosRepository } from '../repository/scenario.repository';
import { getActiveSessionDurationSeconds } from 'src/review/util/review.util';
import { EndScenarioSessionRequestBodyDto } from '../dto/end-scenario-session-request-body.dto';
import { ScenarioSessionRecordingService } from './scenario-session-recording.service';
import { convertTimestampNsToDate } from 'src/common/util/date.util';
import { EgressInfo } from 'livekit-server-sdk';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { SessionEventTranslationService } from 'src/session-event/service/session-event-translation.service';
import { TranscriptTranslationService } from 'src/transcript-translation/service/transcript-translation.service';
import { StartV2VTestSessionDto } from '../dto/start-v2v-test-session.dto';
import { SimulationStateDto } from '../dto/simulation-state.dto';
import { ModuleRef } from '@nestjs/core';
import { ScenarioEngine } from '../enum/scenario-engine.enum';
import { RoleplaySessionService } from 'src/roleplay-studio/service/roleplay-session.service';

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
    private roomMetadataStoreService: RoomMetadataStoreService,
    private livekitService: LiveKitService,
    private sessionEventSharedService: SessionEventSharedService,
    @InjectRepository(ScenarioSessionFeedbacks)
    private scenarioSessionFeedbacksRepository: Repository<ScenarioSessionFeedbacks>,
    @InjectRepository(ScenarioSessionLifecycleEvent)
    private scenarioSessionLifecycleEventRepository: Repository<ScenarioSessionLifecycleEvent>,
    private dataSource: DataSource,
    private aiService: AiService,
    private scenarioTenantService: ScenarioTenantService,
    private readonly cohortVisibilityService: CohortVisibilityService,
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
    private trackProgressService: TrackProgressService,
    private trackMemoryService: TrackMemoryService,
    @InjectRepository(ScenarioSessionBehaviorInstructions)
    private scenarioSessionBehaviorInstructionsRepository: Repository<ScenarioSessionBehaviorInstructions>,
    private behaviorTranslationRepository: BehaviorTranslationRepository,
    private scenarioBehaviorInstructionTranslationRepository: ScenarioBehaviorInstructionTranslationRepository,
    private scenarioEventsRepository: ScenarioEventsRepository,
    private scenariosRepository: ScenariosRepository,
    private scenarioSessionRecordingService: ScenarioSessionRecordingService,
    private sharedLanguageService: SharedLanguageService,
    private sessionEventTranslationService: SessionEventTranslationService,
    private scenarioSessionEvaluationService: ScenarioSessionEvaluationService,
    private scenarioSessionDetailsRepository: ScenarioSessionDetailsRepository,
    private readonly glossaryAdherenceService: GlossaryAdherenceService,
    private transcriptTranslationService: TranscriptTranslationService,
    // App-container handle used ONLY to resolve the Roleplay Studio v2
    // session service for engine=ROLEPLAY_V2 scenarios without importing
    // RoleplayStudioModule into LearnModule (keeps the v1 wiring untouched).
    private moduleRef: ModuleRef,
    private readonly learnerSupervisorMemoryService: LearnerSupervisorMemoryService,
  ) {
    this.logger = LoggerService.getInstance(ScenarioSessionService.name);
  }

  async getMessagesByScenarioSessionId(
    scenarioSessionId: string,
    pagination: Pagination,
    options?: { includeTags?: boolean },
    languageCode?: string,
  ) {
    const result =
      await this.scenarioSharedService.getMessagesByScenarioSessionId(
        scenarioSessionId,
        pagination,
        options,
      );

    if (!languageCode) {
      return result;
    }

    const scenarioSession = await this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId },
    });
    const { enLanguageDetails, languageDetails } =
      await this.getLanguageDetailsForScenarioSession(
        scenarioSession?.metadata?.languageId,
      );
    const sourceLanguageCode =
      languageDetails?.translationCode ?? enLanguageDetails?.translationCode;

    if (languageCode === sourceLanguageCode) {
      return result;
    }

    const translations =
      await this.transcriptTranslationService.translateMessages(
        'scenario',
        result.messages.map((m) => ({ id: m.id, content: m.content })),
        languageCode,
      );

    const messages = result.messages.map((m) => {
      const translatedContent = translations.get(m.id);
      return translatedContent ? { ...m, content: translatedContent } : m;
    });

    return { ...result, messages };
  }

  /** The scenario-session id encoded in a LiveKit room name (`ss_<id>`), or null. */
  sessionIdFromRoomName(roomName: string): string | null {
    return roomName?.startsWith('ss_') ? roomName.slice(3) : null;
  }

  /**
   * Best-effort append of a session lifecycle milestone (room created, agent
   * dispatched/joined, participant joined, recording started, room finished),
   * used by the super-admin session-logs timeline. Never throws — a logging
   * failure must not break session setup/teardown, mirroring the egress/
   * recording best-effort pattern.
   */
  async recordLifecycleEvent(
    scenarioSessionId: string,
    type: ScenarioSessionLifecycleEventType,
    occurredAt: Date = new Date(),
    detail?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.scenarioSessionLifecycleEventRepository.insert({
        scenarioSessionId,
        type,
        occurredAt,
        detail: detail ?? null,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record lifecycle event ${type} for session ` +
          `${scenarioSessionId}: ${(error as Error)?.message}`,
      );
    }
  }

  async getScenarioSessionSkills(
    scenarioSessionId: string,
  ): Promise<ScenarioSessionSkillsResponseDto> {
    // The Skills tab is one of the per-roleplay post-session sub-toggles, so
    // the opt-out is enforced here as well as in the UI — an author who turned
    // scores off for a roleplay meant the learner not to see them, not merely
    // not to be shown a tab.
    const context =
      await this.getSupervisorContextForSession(scenarioSessionId);
    if (context && !context.feedbackTabs.skills) {
      return { skillCoverage: [], emotionalMovement: [] };
    }

    return this.scenarioSharedService.getScenarioSessionSkills(
      scenarioSessionId,
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
      // Active (paused-excluded) duration so the displayed/recorded duration
      // matches what the user is billed/credited for.
      const callDuration = getActiveSessionDurationSeconds(
        scenarioSession.startedAt,
        scenarioSession.endedAt,
        (scenarioSession as any).totalPausedMs,
        (scenarioSession as any).pausedAt,
      );
      if ((scenarioSession as any).details) {
        (scenarioSession as any).details.callDuration = callDuration;
        // summary can legitimately be null (still generating, or the row was
        // written by the evaluation path first) — never let this GET throw on
        // it; the client keeps polling until the summary lands.
        if (
          !enableRecommendations &&
          (scenarioSession as any).details.summary
        ) {
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

    // Serve the report in the viewer's selected UI language. When the requested
    // language differs from the language the stored summary was generated in,
    // serve the cached per-language copy if ready; otherwise kick off a one-off
    // background re-evaluation in that language and return without feedback so
    // the client keeps polling (mirrors the initial-summary generation flow).
    if ((scenarioSession as any).details?.summary) {
      await this.resolveSummaryLanguage(
        (scenarioSession as any).details,
        scenarioSessionId,
        ScenarioSessionService.normalizeLanguage(languageCode),
        enableRecommendations,
      );
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
    const feedbackTabs = resolveFeedbackTabs(scenario?.metadata);

    // The debrief note is gated server-side as well as in the UI: a roleplay
    // whose author turned the Debrief tab off should not ship the note to the
    // client at all. The transcript is deliberately NOT gated at its endpoint —
    // it is the learner's own conversation rather than an evaluation of them,
    // and that endpoint is shared with the peer-review surfaces.
    if (!feedbackTabs.debrief && (scenarioSession as any).details?.summary) {
      delete (scenarioSession as any).details.summary.feedback?.supervisorNote;
    }

    if (scenario) {
      scenario.metadata = {
        experienceMode:
          scenario.metadata?.experienceMode ?? ExperienceMode.FEEDBACK,
        name: scenario.metadata?.name,
        enableFeedback: scenario.metadata?.enableFeedback ?? true,
        // Resolved, never raw: clients render tabs straight off this, so they
        // must not have to re-implement the "absent means all on" default.
        feedbackTabs,
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

    // Roleplay Studio v2 scenarios are thin shells over a versioned spec —
    // the v2 runtime owns their session lifecycle (roleplay- room, AgentV2
    // dispatch, director telemetry). Delegate and skip the entire v1 path.
    // Resolved via ModuleRef (strict: false) so the learn module wiring
    // stays untouched.
    if (scenario.engine === ScenarioEngine.ROLEPLAY_V2) {
      if (!scenario.roleplaySpecId) {
        throw new BadRequestException(
          'Roleplay scenario is missing its spec reference',
        );
      }
      const roleplaySessionService = this.moduleRef.get(
        RoleplaySessionService,
        { strict: false },
      );
      return roleplaySessionService.startSpecSession(
        counselorId,
        scenario.roleplaySpecId,
        null, // published version resolves inside the v2 service
        {
          languageId: startScenarioSessionDto.languageId,
          ttl: startScenarioSessionDto.ttl,
        },
      );
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

    // Learner-facing description returned to the client (viewable on the
    // roleplay screen): prefer the stored translation for the session
    // language. Captured here — before room metadata is built — and NOT
    // mutated onto `scenario`, so the agent's prompt context is unaffected.
    const learnerDescription =
      (isOtherLanguage &&
        scenario?.translations?.[languageDetails?.value]?.description) ||
      scenario?.description;

    // Text reminders shown alongside the description on the roleplay screen.
    // Same translation-lookup shape as description — purely informational,
    // never merged into checklistEvents/sessionEvents below (reminders must
    // stay unlinked from AI scoring).
    const learnerReminders =
      (isOtherLanguage &&
        scenario?.translations?.[languageDetails?.value]?.reminders) ||
      scenario?.metadata?.reminders ||
      [];

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

    // Determine voiceId from scenario metadata languageVoices. Fall back to
    // English when the caller doesn't specify a language (e.g. course/track
    // players with no language picker) — matches the English fallback
    // `isOtherLanguage` already applies above.
    const voiceId =
      scenario?.metadata?.languageVoices?.[languageId ?? enLanguageDetails?.id];

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
      // Attribute the run to a version: explicit request wins, else the
      // scenario's live published version.
      scenarioVersionId:
        startScenarioSessionDto.scenarioVersionId ??
        scenario.publishedVersionId ??
        undefined,
      voiceId,
    };
    // Create scenario session record
    const scenarioSession =
      await this.scenarioSessionRepository.createScenarioSession(counselorId, {
        ...startScenarioSessionDtoData,
      });

    try {
      // Best-effort: record which prompt versions drive this session so drift
      // analytics can attribute behaviour to a prompt-version experiment.
      // Capture must never block session start.
      try {
        const promptVersions =
          await this.scenarioSharedService.getResolvedPromptVersionsForScenarioSession();
        // Also record WHICH main-agent prompt was selected and the effective
        // language-variant (GENERIC vs MULTILINGUAL) this session actually ran,
        // so drift analytics and session logs can attribute/compare per prompt
        // and per variant (the alphabetical promptVersions pick can't).
        const selectedMainPromptCode = scenario?.metadata
          ?.selectedMainPromptCode as string | undefined;
        const mainPromptVariant = shouldServeMultilingual(
          languageDetails,
          scenario?.metadata?.mainPromptVariantByLanguage as
            | Record<string, string>
            | undefined,
        )
          ? 'MULTILINGUAL'
          : 'GENERIC';

        scenarioSession.metadata = {
          ...(scenarioSession.metadata ?? {}),
          ...(Object.keys(promptVersions).length > 0 ? { promptVersions } : {}),
          ...(selectedMainPromptCode ? { selectedMainPromptCode } : {}),
          mainPromptVariant,
        };
        await this.scenarioSessionRepository.save(scenarioSession);
      } catch {
        // capture is best-effort; ignore failures
      }

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
        if (!previousMemory) {
          // First item of the case (or nothing inheritable within it): when
          // the case is nested in a track, fall back to the track-level
          // previous memory so the case doesn't open cold.
          previousMemory = await this.getPreviousTrackMemoryForCaseItem(
            startScenarioSessionDto.caseSessionItemId,
          );
        }
      } else if (startScenarioSessionDto.trackItemProgressId) {
        // Track read path: open with the memory of the nearest preceding
        // conversation item (roleplay or case) in track order.
        previousMemory = await this.getPreviousTrackMemory(
          startScenarioSessionDto.trackItemProgressId,
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

      // Preparing state instructions for simulation room, only if currentState is present for scenario
      const stateNames: StateNames[] = this.getStateNames(
        scenario?.metadata?.currentState,
        scenario?.metadata?.stateNames,
        scenario?.metadata?.states,
      );
      // Reminders are only shown to the learner when remindersEnabled is on for the scenario
      const reminders = this.getReminders(
        scenario?.metadata?.remindersEnabled,
        learnerReminders,
      );
      // Store the full envelope and put only a fetch pointer on the room and
      // dispatch (when LEARN_METADATA_FETCH_ENABLED; legacy inline otherwise).
      // Keeps the agent availability request tiny — the inline ~180KB envelope
      // is what blew LiveKit's 3s dispatch window and stranded joins.
      const { roomPayload, dispatchPayload } =
        await this.roomMetadataStoreService.prepareRoomMetadata(
          `${scenarioSession.roomId}`,
          roomMetadata,
        );

      // Create LiveKit room
      await this.livekitService.createRoom({
        name: `${scenarioSession.roomId}`,
        ttl:
          startScenarioSessionDto.ttl ?? DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
        metadata: roomPayload,
      });
      void this.recordLifecycleEvent(
        scenarioSession.id,
        ScenarioSessionLifecycleEventType.ROOM_CREATED,
      );

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
          JSON.stringify(dispatchPayload),
        )
        .then(() =>
          this.recordLifecycleEvent(
            scenarioSession.id,
            ScenarioSessionLifecycleEventType.AGENT_DISPATCHED,
            new Date(),
            {
              via: 'proactive',
              agentName: this.configService.livekit.agentName,
            },
          ),
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
        description: learnerDescription,
        reminders,
        remindersEnabled: scenario?.metadata?.remindersEnabled,
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
        pauseEnabled: scenario?.metadata?.pauseEnabled,
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
    } else if (startScenarioSessionDto.trackItemProgressId) {
      // Track 2.0: validate the roleplay belongs to an unlocked track item
      // visible to the caller's tenant.
      const userIdStr = ExecutionManager.getUserId();
      await this.trackProgressService.validateRoleplayStart(
        startScenarioSessionDto.trackItemProgressId,
        scenarioId,
        { userId: Number(userIdStr), tenantId },
      );
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

      // Second access layer: the learner's cohort. Only on this branch — the
      // standalone roleplay start. The path / track / case branches above are
      // reached through a container the learner already had to be admitted to,
      // and that container's own access check is the right authority: a course
      // assigned to your cohort must not break halfway through because one of its
      // roleplays is separately restricted.
      //
      // No "already started" grace: a roleplay is a single session with nothing
      // to resume, so there is no in-progress work for the rule to protect.
      const cohortAllowed = await this.cohortVisibilityService.canAccess({
        contentType: CohortContentType.SCENARIO,
        contentId: String(scenarioId),
        tenantId,
        userId: counselorId,
      });
      if (!cohortAllowed) {
        throw new BadRequestException(
          'This simulation is not available for your group',
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
      // Pass counselorId as both args: for SYSTEM_ACCESS users (e.g. a
      // superadmin running a V2V test) getSimulationCredits resolves the target
      // from the second arg, so omitting it throws "User ID is required".
      await this.simulationCreditsService.getSimulationCredits(
        counselorId,
        counselorId,
      );
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
    // Exclude paused time so path/case progress and the leaderboard count only
    // active conversation (closes any still-open pause interval at end).
    callDuration = Math.max(
      0,
      callDuration - this.effectiveTotalPausedMs(scenarioSession, endedAt),
    );
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
    } else if (scenarioSession.trackItemProgressId) {
      // Track 2.0: roleplay played inside a track.
      await this.trackProgressService.handleRoleplayEnd({
        trackItemProgressId: scenarioSession.trackItemProgressId,
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

    // Score the roleplay actor against the configured agent test cases
    // (async, best-effort — never blocks or fails session end).
    await this.scenarioSessionEvaluationService.triggerForSession(
      scenarioSession,
    );

    // Glossary adherence: deterministic avoid-list scan of the agent
    // transcript, auto-run per session so every run (human or v2v) leaves a
    // one-shot quality scorecard row. Self-gating: returns null for English
    // sessions, languages without a published glossary, or glossaries with
    // no avoid-terms. Fire-and-forget — never blocks or fails session end.
    void this.glossaryAdherenceService
      .analyzeSession(scenarioSession.id)
      .then((report) => {
        if (report) {
          this.logger.info(
            `[GLOSSARY_ADHERENCE] session ${scenarioSession.id}: ` +
              `${report.totalViolations} violation(s) across ` +
              `${report.agentMessageCount} agent message(s)`,
          );
        }
      })
      .catch((error) => {
        this.logger.warn(
          `[GLOSSARY_ADHERENCE] scan failed for ${scenarioSession.id}: ${error}`,
        );
      });

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
    // Exclude paused time so the user is never billed for pauses (closes any
    // still-open pause interval if the session ended while paused).
    callDuration = Math.max(
      0,
      callDuration - this.effectiveTotalPausedMs(scenarioSession, endedAt),
    );

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
      endScenarioSessionRequestBodyDto?.languageCode,
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

  /**
   * Everything the supervisor debrief needs about WHO practised and WHAT the
   * roleplay is configured to show them.
   *
   * Returns null only when the session or its scenario has vanished, in which
   * case the caller carries on with a note that has no personalisation rather
   * than failing the whole evaluation — feedback with a generic opening beats
   * no feedback at all.
   */
  private async getSupervisorContextForSession(
    scenarioSessionId: string,
  ): Promise<{
    counselorId: number;
    workerType: WorkerType;
    learnerFirstName?: string;
    feedbackTabs: FeedbackTabsConfig;
  } | null> {
    try {
      const scenarioSession = await this.scenarioSessionRepository.findOne({
        where: { id: scenarioSessionId },
        select: { id: true, counselorId: true, scenarioId: true },
      });
      if (!scenarioSession) return null;

      const [scenario, user] = await Promise.all([
        this.scenariosRepository.findOne({
          where: { id: scenarioSession.scenarioId },
          select: { id: true, metadata: true },
        }),
        // Resolved off the DataSource rather than an injected UserService:
        // pulling src/user/service/* into this graph is the documented way to
        // break boot with a circular DI import.
        this.dataSource.getRepository(User).findOne({
          where: { id: scenarioSession.counselorId },
          select: { id: true, name: true, metadata: true },
        }),
      ]);

      return {
        counselorId: scenarioSession.counselorId,
        workerType: resolveWorkerType(user?.metadata),
        // First name only. The note greets someone the way a supervisor
        // would, and "Nice work today, Priya Sharma" reads like a form letter.
        learnerFirstName: user?.name?.trim().split(/\s+/)[0] || undefined,
        feedbackTabs: resolveFeedbackTabs(scenario?.metadata),
      };
    } catch (error) {
      this.logger.error(
        `getSupervisorContextForSession failed for ${scenarioSessionId}: ${error?.message}`,
      );
      return null;
    }
  }

  private async getScenarioSessionSummaryFromAI(
    scenarioSessionId: string,
    needMemory: boolean,
    callDuration?: number,
    previousMemory?: string | null,
    enableRecommendations?: boolean,
    languageCode?: string,
  ) {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      this.logger.error(
        'getScenarioSessionSummaryFromAI: tenantId not found in execution context',
      );
      return;
    }

    // Idempotency: endScenarioSession has several unguarded entry points (the
    // learner-facing controller, the /end-v2v webhook, auto-termination), so a
    // client retry or redelivered event would otherwise re-run a full
    // transcript evaluation over a session that already has feedback.
    // Only a SUCCESSFUL summary blocks a rerun — a row holding just
    // `errorMessage` (no messages / too short / AI failed) stays retriable,
    // which is what the "Please try again" copy promises the learner.
    const existingDetails = await this.scenarioSessionDetailsRepository.findOne(
      {
        where: { scenarioSessionId, tenantId },
        select: { id: true, summary: true },
      },
    );
    if (existingDetails?.summary?.feedback) {
      this.logger.info(
        `Skipping summary generation for ${scenarioSessionId}: feedback already generated.`,
      );
      return;
    }

    // Who this session belongs to, and which post-session surfaces the roleplay
    // actually shows. Both are needed before any LLM work: the learner drives
    // the note's register and continuity, and a roleplay showing no feedback
    // tabs at all must not pay for an evaluation nobody can see.
    const sessionContext =
      await this.getSupervisorContextForSession(scenarioSessionId);

    let summary;
    try {
      if (
        sessionContext &&
        !feedbackTabsNeedEvaluation(sessionContext.feedbackTabs)
      ) {
        this.logger.info(
          `Skipping evaluation for ${scenarioSessionId}: roleplay shows no post-session feedback tabs.`,
        );
        return;
      }

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

        // What the supervisor already knows about this learner, so the note can
        // open on continuity ("last time we worked on...") instead of meeting
        // them fresh every session. Absent for a learner's first debrief.
        const supervisorMemory = sessionContext
          ? await this.learnerSupervisorMemoryService.getSupervisorMemoryPrompt(
              sessionContext.counselorId,
              tenantId,
            )
          : null;

        const aiResult = useEvaluation
          ? await this.aiService.getScenarioSessionEvaluation(
              messages as ScenarioEvaluationChatMessage[],
              needMemory,
              previousMemory,
              undefined,
              enableRecommendations,
              languageCode,
              {
                workerType: sessionContext?.workerType,
                learnerName: sessionContext?.learnerFirstName,
                supervisorMemory,
              },
            )
          : await this.aiService.getScenarioSessionSummary(
              messages as MessageRequest[],
              needMemory,
              previousMemory,
            );

        // Carry this debrief forward before the response is camelCased — the
        // learner's memory is keyed to them, not to this session, and is the
        // one artefact here that outlives the row we are about to write.
        if (
          useEvaluation &&
          sessionContext &&
          aiResult &&
          'memory_update' in aiResult
        ) {
          await this.learnerSupervisorMemoryService.recordFromEvaluation(
            sessionContext.counselorId,
            tenantId,
            scenarioSessionId,
            aiResult.memory_update,
          );
        }

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

        // memory_update is the supervisor's private note-to-self about the
        // learner; it has already been persisted to their memory row above.
        // Drop it here so it never reaches the payload the learner is served —
        // being told how your supervisor characterises your trajectory is not
        // the same thing as being given feedback.
        const learnerFacingResult = { ...(aiResult as Record<string, any>) };
        delete learnerFacingResult.memory_update;

        const aiSummary = CommonUtil.convertToCamelCase(learnerFacingResult);
        summary = {
          feedback: aiSummary,
          // Language this default feedback was generated in (normalized primary
          // subtag, e.g. 'hi'). getScenarioSession() reads this to decide
          // whether a viewer's selected UI language needs an on-demand
          // per-language re-evaluation (cached under summary.translations).
          language: ScenarioSessionService.normalizeLanguage(languageCode),
        };
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
    // Atomic upsert: the evaluation writer races this on session end, and a
    // blind INSERT here used to create a second details row (the
    // missing-feedback bug — see migration 1869).
    try {
      await this.dataSource.transaction(async (entityManager) => {
        const scenarioSessionDetailsRepo = entityManager.getRepository(
          ScenarioSessionDetails,
        );
        await scenarioSessionDetailsRepo.upsert(
          {
            scenarioSessionId,
            callDuration,
            summary: summary as Record<string, any>,
            tenantId,
          },
          { conflictPaths: ['scenarioSessionId'] },
        );
      });
    } catch (error) {
      this.logger.error(
        `Failed to persist scenario session details for ${scenarioSessionId}: ${JSON.stringify(error.message)}`,
      );
    }
  }

  /**
   * Normalize a BCP 47 / ISO 639-1 language code to its lowercase primary
   * subtag (e.g. 'hi-IN' -> 'hi', 'EN' -> 'en'). Returns undefined for empty
   * input so callers can treat "no language" uniformly.
   */
  static normalizeLanguage(code?: string | null): string | undefined {
    if (!code) return undefined;
    const primary = code.replace(/_/g, '-').split('-')[0].trim().toLowerCase();
    return primary || undefined;
  }

  /**
   * Decide which language's feedback to serve for a GET, mutating
   * `details.summary` in place:
   *  - no language requested / it matches the stored (default) language / there
   *    is no base feedback yet (still generating, errored, too short) -> serve
   *    the stored summary unchanged.
   *  - a COMPLETED per-language copy exists -> swap it in.
   *  - otherwise -> ensure a one-off background re-evaluation is running and
   *    clear `feedback` so the polling client keeps waiting until it lands.
   * Internal cache fields (`language`, `translations`) are always stripped from
   * the response.
   */
  private async resolveSummaryLanguage(
    details: { summary?: Record<string, any> },
    scenarioSessionId: string,
    requestedLanguage: string | undefined,
    enableRecommendations: boolean,
  ): Promise<void> {
    const summary = details.summary;
    if (!summary) return;

    const baseLanguage = ScenarioSessionService.normalizeLanguage(
      summary.language,
    );

    let feedbackToServe = summary.feedback;

    const needsOtherLanguage =
      !!requestedLanguage &&
      requestedLanguage !== baseLanguage &&
      !!summary.feedback &&
      !summary.errorMessage;

    if (needsOtherLanguage) {
      const translations: Record<string, any> = summary.translations ?? {};
      const cached = translations[requestedLanguage as string];
      if (cached?.status === 'COMPLETED' && cached.feedback) {
        feedbackToServe = cached.feedback;
      } else {
        if (!cached || cached.status === 'FAILED') {
          await this.triggerLanguageSummaryGeneration(
            scenarioSessionId,
            requestedLanguage as string,
            enableRecommendations,
          );
        }
        // Not ready yet: withhold feedback so the client polls until the
        // requested-language copy completes.
        feedbackToServe = undefined;
      }
    }

    details.summary = { ...summary, feedback: feedbackToServe };
    delete details.summary.translations;
    delete details.summary.language;
  }

  /**
   * Atomically reserve a PENDING slot for `languageCode` and, if this caller
   * won the race, fire-and-forget the re-evaluation. The pessimistic row lock
   * means concurrent polls don't spawn duplicate generations.
   */
  private async triggerLanguageSummaryGeneration(
    scenarioSessionId: string,
    languageCode: string,
    enableRecommendations: boolean,
  ): Promise<void> {
    const tenantId = ExecutionManager.getTenantId();
    if (!tenantId) {
      this.logger.error(
        'triggerLanguageSummaryGeneration: tenantId not found in execution context',
      );
      return;
    }

    let shouldGenerate = false;
    try {
      await this.dataSource.transaction(async (entityManager) => {
        const repo = entityManager.getRepository(ScenarioSessionDetails);
        const row = await repo.findOne({
          where: { scenarioSessionId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        // Only translate a successfully-generated base summary.
        if (!row?.summary?.feedback || row.summary.errorMessage) return;
        const translations: Record<string, any> =
          row.summary.translations ?? {};
        const existing = translations[languageCode];
        if (
          existing?.status === 'PENDING' ||
          (existing?.status === 'COMPLETED' && existing.feedback)
        ) {
          return;
        }
        translations[languageCode] = { status: 'PENDING' };
        row.summary = { ...row.summary, translations };
        await repo.save(row);
        shouldGenerate = true;
      });
    } catch (error) {
      this.logger.error(
        `Failed to reserve ${languageCode} summary slot for ${scenarioSessionId}: ${JSON.stringify(
          (error as Error)?.message,
        )}`,
      );
      return;
    }

    if (!shouldGenerate) return;

    // Intentionally not awaited: a full re-evaluation can take tens of seconds;
    // the GET returns immediately and the client polls for the cached result.
    this.generateLanguageSummary(
      scenarioSessionId,
      languageCode,
      enableRecommendations,
      tenantId,
    ).catch((error) => {
      this.logger.error(
        `generateLanguageSummary rejected for ${scenarioSessionId}/${languageCode}: ${JSON.stringify(
          (error as Error)?.message,
        )}`,
      );
    });
  }

  /**
   * Re-run the LLM evaluation in `languageCode` and cache the result under
   * `summary.translations[languageCode]`. Language-independent artifacts
   * (message tags / scores already tied to message IDs, conversation memory)
   * are NOT re-persisted — only the human-readable feedback is regenerated and
   * stored per language.
   */
  private async generateLanguageSummary(
    scenarioSessionId: string,
    languageCode: string,
    enableRecommendations: boolean,
    tenantId: string,
  ): Promise<void> {
    const writeStatus = async (entry: Record<string, any>) => {
      await this.dataSource.transaction(async (entityManager) => {
        const repo = entityManager.getRepository(ScenarioSessionDetails);
        const row = await repo.findOne({
          where: { scenarioSessionId, tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!row?.summary) return;
        const translations: Record<string, any> =
          row.summary.translations ?? {};
        translations[languageCode] = entry;
        row.summary = { ...row.summary, translations };
        await repo.save(row);
      });
    };

    try {
      const scenarioSessionMessages =
        await this.scenarioSessionMessagesRepository.find({
          where: {
            scenarioSessionId,
            messageType: ScenarioSessionMessageType.TEXT,
            tenantId,
          },
        });

      if (scenarioSessionMessages.length === 0) {
        await writeStatus({
          status: 'FAILED',
          errorMessage: 'No messages to evaluate.',
        });
        return;
      }

      const messages: ScenarioEvaluationChatMessage[] =
        scenarioSessionMessages.map((message) => ({
          id: message.id.toString(),
          role: message.senderId > 0 ? 'COUNSELOR' : 'CLIENT',
          content: message.content,
          start_time: message.startSeconds,
          end_time: message.endSeconds,
        }));

      // need_memory=false: memory is language-independent and already computed
      // at end-session; this call only regenerates the feedback text.
      const aiResult = await this.aiService.getScenarioSessionEvaluation(
        messages,
        false,
        null,
        undefined,
        enableRecommendations,
        languageCode,
      );

      if (aiResult && 'emotional_movement' in aiResult) {
        const messageStartSecondsByMessageId = new Map(
          scenarioSessionMessages.map((m) => [m.id, m.startSeconds ?? 0]),
        );
        for (const item of aiResult.emotional_movement) {
          const messageId = parseInt(item.message_id, 10);
          item.start_time = messageStartSecondsByMessageId.get(messageId);
        }
      }

      const aiSummary = CommonUtil.convertToCamelCase(aiResult);
      await writeStatus({ status: 'COMPLETED', feedback: aiSummary });
    } catch (error) {
      this.logger.error(
        `Failed to generate ${languageCode} summary for ${scenarioSessionId}: ${JSON.stringify(
          (error as Error)?.message,
        )}`,
      );
      await writeStatus({
        status: 'FAILED',
        errorMessage: 'Failed to generate summary in the selected language.',
      }).catch(() => undefined);
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
        // Only when the worker actually reported it. Undefined stays absent
        // rather than becoming `false`: the language judge conditions on
        // presence, and an older worker's silence must not read as "this turn
        // was not interrupted". See MessageRequest.interrupted.
        ...(chatMessage.interrupted !== undefined && {
          metadata: { interrupted: chatMessage.interrupted },
        }),
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
      case 'session-paused':
        await this.handleSessionPausedEvent(scenarioSession, event);
        break;
      case 'session-resumed':
        await this.handleSessionResumedEvent(scenarioSession, event);
        break;
      default:
        await this.addScenarioSessionEvent(scenarioSession, event);
        break;
    }
  }

  /**
   * Mark a session paused. Stores `pausedAt` so that if the session ends while
   * still paused (no resume arrives), the open interval can be closed at end.
   * The agent's SessionClock is the source of truth for cumulative paused time,
   * so we don't accumulate here — we only record the open-interval start.
   */
  async handleSessionPausedEvent(
    scenarioSession: ScenarioSessions,
    event: LearnEventData,
  ) {
    if (scenarioSession.status === ScenarioSessionStatus.ENDED) return;
    const atMs = event.event_data.atMs;
    const pausedAt = atMs ? new Date(atMs) : new Date();
    await this.scenarioSessionRepository.update(scenarioSession.id, {
      pausedAt,
    });
    this.logger.info(
      `Scenario session ${scenarioSession.id} paused at ${pausedAt.toISOString()}`,
    );
  }

  /**
   * Mark a session resumed. Sets `totalPausedMs` to the agent-reported
   * cumulative value (robust to duplicate/out-of-order events) and clears
   * `pausedAt`.
   */
  async handleSessionResumedEvent(
    scenarioSession: ScenarioSessions,
    event: LearnEventData,
  ) {
    if (scenarioSession.status === ScenarioSessionStatus.ENDED) return;
    // The agent reports cumulative paused ms. Apply it atomically with GREATEST
    // so a reordered/duplicate/concurrent event can never lower the stored
    // total (read-modify-write in JS would be racy). reported is clamped to a
    // non-negative integer since it is interpolated into SQL.
    const reported = Math.max(
      0,
      Math.trunc(event.event_data.totalPausedMs ?? 0),
    );
    await this.scenarioSessionRepository.update(scenarioSession.id, {
      pausedAt: null,
      totalPausedMs: () => `GREATEST("totalPausedMs", ${reported})`,
    });
    this.logger.info(
      `Scenario session ${scenarioSession.id} resumed; totalPausedMs>=${reported}`,
    );
  }

  /**
   * Effective paused milliseconds to exclude from a session's duration,
   * including an open pause interval if the session ended while still paused.
   */
  private effectiveTotalPausedMs(
    scenarioSession: ScenarioSessions,
    endedAt: Date,
  ): number {
    let total = scenarioSession.totalPausedMs ?? 0;
    if (scenarioSession.pausedAt) {
      total += Math.max(
        0,
        endedAt.getTime() - scenarioSession.pausedAt.getTime(),
      );
    }
    return total;
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
   * Fallback language for a turn/start-metrics row when the SQS payload didn't
   * carry one (the ally-ai-learn runtime doesn't always send it) — resolves the
   * session's own configured language (metadata.languageId -> languages.value),
   * the same source every read-time language join in analytics/drift/session
   * logs already resolves against. Defaults to 'en' when unset/unresolvable.
   */
  private async resolveSessionLanguageValue(
    scenarioSession: ScenarioSessions,
  ): Promise<string> {
    const languageId = Number(scenarioSession.metadata?.languageId);
    return this.sharedLanguageService.getLanguageValueById(
      Number.isFinite(languageId) && languageId > 0 ? languageId : null,
    );
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
    const language =
      metrics.language ??
      (await this.resolveSessionLanguageValue(scenarioSession));
    const row = repo.create({
      scenarioSessionId: scenarioSession.id,
      tenantId: scenarioSession.tenantId,
      roomId: scenarioSession.roomId,
      turnIndex: metrics.turn_index,
      invocationId: metrics.invocation_id,
      responseLatencyMs: metrics.response_latency_ms,
      eouDelayMs: metrics.eou_delay_ms,
      sttFinalizeMs: metrics.stt_finalize_ms,
      llmTtftMs: metrics.llm_ttft_ms,
      promptTokens: metrics.prompt_tokens,
      cachedTokens: metrics.cached_tokens,
      ttsTtfbMs: metrics.tts_ttfb_ms,
      orchestrationMs: metrics.orchestration_ms,
      llmResponseMs: metrics.llm_response_ms,
      branchingMs: metrics.branching_ms,
      knowledgeRetrievalMs: metrics.knowledge_retrieval_ms,
      processEventsMs: metrics.process_events_ms,
      behaviorsMs: metrics.behaviors_ms,
      scenarioId: metrics.scenario_id ?? scenarioSession.scenarioId,
      language,
      llmModel: metrics.llm_model,
      llmProvider: metrics.llm_provider,
      env: metrics.env,
      responseChars: metrics.response_chars,
      eventsDetected: metrics.events_detected ?? 0,
      llmTimedOut: metrics.llm_timed_out ?? false,
      interrupted: metrics.interrupted ?? false,
      occurredAt: occurredAt ?? new Date(),
      // Fold generation params into metadata (kept out of the wide column set
      // since they're usually fixed per experiment; provider is a column).
      metadata: {
        ...(metrics.metadata ?? {}),
        ...(metrics.temperature != null && {
          temperature: metrics.temperature,
        }),
        ...(metrics.top_p != null && { topP: metrics.top_p }),
        ...(metrics.max_tokens != null && { maxTokens: metrics.max_tokens }),
      },
    });
    // Idempotent against SQS redelivery. This queue is at-least-once and the
    // processor rethrows on failure, so the same turn can arrive twice; the
    // unique index on (scenarioSessionId, turnIndex, source) turns the second
    // arrival into a no-op instead of a duplicate row that would double-count
    // the turn in every latency aggregate. DO NOTHING rather than an error also
    // keeps a redelivery from failing the message and looping it.
    await repo.createQueryBuilder().insert().values(row).orIgnore().execute();
  }

  /**
   * Persist tester-side v2v run metrics ({maxExchanges, exchangesCompleted,
   * utterancesHeard, ttsFailures, endReason}) onto the session's metadata
   * (metadata.v2vMetrics) — the queryable evaluation baseline for automated
   * v2v testing. jsonb merge so concurrent metadata writers are untouched.
   */
  async recordV2VMetrics(
    scenarioSessionId: string,
    metrics: Record<string, any>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE scenario_sessions
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('v2vMetrics', $2::jsonb)
       WHERE id = $1`,
      [scenarioSessionId, JSON.stringify(metrics)],
    );
  }

  /**
   * Persist the agent's end-of-session episodic memory (message_type
   * "session_memory") onto the per-session details row. Atomic upsert against
   * the unique scenarioSessionId index (migration 1869) — only sessionMemory
   * (and tenantId on insert) is written, so it never clobbers the summary or
   * evaluation columns regardless of arrival order relative to session end.
   */
  async addSessionMemory(
    scenarioSession: ScenarioSessions,
    memory: LearnSessionMemoryData,
    receivedAt?: Date,
  ): Promise<void> {
    const sessionMemory: Record<string, any> = {
      summary: memory.summary,
      language: memory.language ?? null,
      messageCount: memory.message_count ?? null,
      summarizedMessageCount: memory.summarized_message_count ?? null,
      structured: memory.structured ?? null,
      receivedAt: (receivedAt ?? new Date()).toISOString(),
    };
    // The agent emits in two phases: the maintained summary immediately
    // (guaranteed to beat its shutdown runway), then a higher-coverage
    // "final compaction" upgrade when time allows. The ON CONFLICT ... WHERE
    // guard keeps whichever write covers more messages, so out-of-order SQS
    // delivery or a duplicate redrive can never replace an upgrade with the
    // stale phase-1 payload. Insert path matches the details-row upsert
    // convention (unique scenarioSessionId index, migration 1869).
    await this.dataSource.query(
      `INSERT INTO scenario_session_details ("scenarioSessionId", "tenant_id", "sessionMemory")
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT ("scenarioSessionId") DO UPDATE SET
         "sessionMemory" = EXCLUDED."sessionMemory",
         "updatedAt" = now()
       WHERE COALESCE((scenario_session_details."sessionMemory"->>'summarizedMessageCount')::int, -1)
         <= COALESCE((EXCLUDED."sessionMemory"->>'summarizedMessageCount')::int, 0)`,
      [
        scenarioSession.id,
        scenarioSession.tenantId,
        JSON.stringify(sessionMemory),
      ],
    );
  }

  /**
   * Persist the simulation's START latency ("time to first word") into
   * scenario_session_start_metrics — one row per session, emitted live by the
   * agent (source='pipeline'). `occurredAt` is the agent-side opening timestamp;
   * falls back to now() if absent.
   */
  async addStartMetrics(
    scenarioSession: ScenarioSessions,
    metrics: LearnStartMetricsData,
    occurredAt?: Date,
  ): Promise<void> {
    const repo = this.dataSource.getRepository(ScenarioSessionStartMetrics);
    const language =
      metrics.language ??
      (await this.resolveSessionLanguageValue(scenarioSession));
    const row = repo.create({
      scenarioSessionId: scenarioSession.id,
      tenantId: scenarioSession.tenantId,
      roomId: scenarioSession.roomId,
      startLatencyMs: metrics.start_latency_ms,
      configureMs: metrics.configure_ms,
      initializeMs: metrics.initialize_ms,
      connectMs: metrics.connect_ms,
      prepMs: metrics.prep_ms,
      openingPlayoutMs: metrics.opening_playout_ms,
      scenarioId: metrics.scenario_id ?? scenarioSession.scenarioId,
      language,
      env: metrics.env,
      occurredAt: occurredAt ?? new Date(),
      source: 'pipeline',
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
    const { scenarioId, languageId, scenarioVersionId } = previewScenarioDto;

    const scenario = scenarioVersionId
      ? await this.scenarioSharedService.buildScenarioOverrideFromVersion(
          scenarioId,
          scenarioVersionId,
        )
      : await this.scenarioService.getAdminScenario(scenarioId);

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

    // Determine voiceId from scenario metadata languageVoices. Fall back to
    // English when the caller doesn't specify a language, matching the
    // English fallback `isOtherLanguage` already applies above.
    const voiceId =
      scenario?.metadata?.languageVoices?.[languageId ?? enLanguageDetails?.id];

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
      scenario?.metadata?.states,
    );

    // Fetch-pointer metadata when enabled (see startScenarioSession).
    const { roomPayload, dispatchPayload } =
      await this.roomMetadataStoreService.prepareRoomMetadata(
        roomName,
        roomMetadata,
      );

    await this.livekitService.createRoom({
      name: roomName,
      metadata: roomPayload,
    });

    // Cache metadata for direct dispatch (local dev when webhook unreachable).
    // Cache exactly what a dispatch should carry, so dispatchPreviewAgent
    // sends the same payload shape as the proactive path.
    if (this.configService.allowDirectAgentDispatch) {
      previewRoomMetadataCache.set(roomName, dispatchPayload);
    }

    // Proactively dispatch the agent so it can initialize during the frontend's
    // ringing-bell delay. Mirrors startScenarioSession; the existing
    // dispatchPreviewAgent endpoint and webhook fallback both stay as safety nets.
    this.livekitService.preMarkProactiveDispatch(roomName);
    this.livekitService
      .agentDispatch(
        roomName,
        this.configService.livekit.agentName,
        JSON.stringify(dispatchPayload),
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

    // This endpoint feeds the learner's post-session summary only — the
    // in-session checklist panel is served from the LiveKit room metadata — so
    // the summary opt-in is enforced here as well as in the UI. Absent means
    // off, which keeps every roleplay authored before the toggle existed dark.
    if (
      experienceMode !== ExperienceMode.CHECKLIST ||
      scenario.metadata?.summaryChecklistEnabled !== true
    ) {
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

  getStateNames(
    currentState?: boolean,
    stateNames?: StateNames[],
    states?: SimulationStateDto[],
  ) {
    if (!currentState) return [];
    // `states` (hasStates main-agent prompts, edited via StatesEditor) carries
    // the real names for skills built on the newer states structure. Prefer
    // it over the legacy `stateNames` — which StatesEditor never populates —
    // so those skills don't fall back to the generic "State 1" defaults.
    if (states?.length) {
      return states.map((state) => ({
        name: state.name,
        stateId: state.id,
      }));
    }
    if (stateNames?.length) {
      return stateNames.map((stateName: StateNames) => {
        return {
          name: stateName.name,
          stateId: stateName.stateId,
        };
      });
    }
    return [];
  }

  getReminders(remindersEnabled?: boolean, reminders?: string[]) {
    if (remindersEnabled && reminders?.length) {
      return reminders;
    }
    return [];
  }

  /**
   * Track read path for episodic memory: resolve the memory a track roleplay
   * should open with — the nearest preceding ROLEPLAY/CASE item (track
   * order) that left a session memory. Candidates come from the track
   * progression engine; each is resolved against session data here, first
   * hit wins. Best-effort: any failure logs and returns null (a track
   * roleplay must start even when memory lookup breaks).
   */
  private async getPreviousTrackMemory(
    trackItemProgressId: string,
  ): Promise<string | null> {
    try {
      // Prefer the enrollment's consolidated memory (the evolving fold over
      // every conversation item so far); the per-item walk below is the
      // fallback for enrollments that predate consolidation or whose folds
      // all failed.
      const consolidated =
        await this.trackMemoryService.getConsolidatedMemory(
          trackItemProgressId,
        );
      if (consolidated) return consolidated;

      const candidates =
        await this.trackProgressService.getPreviousMemoryCandidates(
          trackItemProgressId,
        );
      for (const candidate of candidates) {
        let memory: string | null = null;
        if (candidate.trackItemProgressId) {
          memory =
            await this.scenarioSharedService.getLatestSessionMemoryByTrackItemProgressId(
              candidate.trackItemProgressId,
            );
        } else if (candidate.caseSessionId) {
          memory =
            await this.caseSharedService.getLatestSessionMemoryByCaseSessionId(
              candidate.caseSessionId,
            );
        }
        if (memory) return memory;
      }
      return null;
    } catch (error) {
      this.logger.error(
        `getPreviousTrackMemory failed for ${trackItemProgressId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Case-in-track fallback: a case session item whose case has no
   * inheritable memory (typically the case's first item) inherits the track
   * memory instead, resolved through the track_item_progress row that owns
   * the case session. Null when the case isn't inside a track.
   */
  private async getPreviousTrackMemoryForCaseItem(
    caseSessionItemId: string,
  ): Promise<string | null> {
    try {
      const caseSessionId =
        await this.caseSharedService.getCaseSessionIdBySessionItemId(
          caseSessionItemId,
        );
      if (!caseSessionId) return null;
      const progressId =
        await this.trackProgressService.getProgressIdByCaseSessionId(
          caseSessionId,
        );
      if (!progressId) return null;
      return await this.getPreviousTrackMemory(progressId);
    } catch (error) {
      this.logger.error(
        `getPreviousTrackMemoryForCaseItem failed for ${caseSessionItemId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * Start an AI-vs-AI V2V test session (super-admin only).
   *
   * Creates a real ScenarioSession (visible in Roleplay Session Logs, tagged
   * with metadata.v2vTest=true) where the counselor AI runs as normal and an
   * AI simulated learner joins as the user side via a low-cost TTS/LLM.
   */
  async startV2VTestSession(
    userId: number,
    dto: StartV2VTestSessionDto,
  ): Promise<{
    scenarioSession: ScenarioSessions;
    isTestSession: boolean;
    simulatedUserAgent: string;
  }> {
    const {
      scenarioId,
      languageId,
      maxExchanges = 12,
      trackItemProgressId,
    } = dto;

    const scenario = await this.scenarioService.getAdminScenario(scenarioId);
    if (!scenario) {
      throw new BadRequestException('Scenario not found');
    }

    // Reuse the same validation as preview (status + mandatory fields check).
    await this.validatePreviewScenario(scenario);
    await this.validateGlobalSimulationCapacity();

    // Optional: run the test as a track item, exercising the full track
    // flow (unlock validation, previous-memory injection, completion and
    // memory folding on end).
    let trackPreviousMemory: string | null = null;
    if (trackItemProgressId) {
      const tenantId = ExecutionManager.getTenantId();
      if (!tenantId) {
        throw new BadRequestException(
          'Tenant context required for track-item V2V tests',
        );
      }
      await this.trackProgressService.validateRoleplayStart(
        trackItemProgressId,
        scenarioId,
        { userId, tenantId },
      );
      trackPreviousMemory =
        await this.getPreviousTrackMemory(trackItemProgressId);
    }

    const { enLanguageDetails, languageDetails } =
      await this.getLanguageDetailsForScenarioSession(languageId);

    const isOtherLanguage =
      languageId &&
      languageDetails &&
      !isEnglishLanguage(
        languageId,
        languageDetails.value,
        enLanguageDetails?.id,
      );

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

    if (isOtherLanguage && (scenario?.terminationEvents?.length ?? 0) > 0) {
      scenario.terminationEvents = scenario.terminationEvents!.map(
        (termEvent) => {
          const translated = sessionEvents.find(
            (e) => e.id === termEvent?.eventId,
          );
          return translated
            ? {
                ...translated,
                eventId: translated.id,
                autoTerminationStatus: true,
              }
            : termEvent;
        },
      );
    }

    // Fall back to English when the caller doesn't specify a language,
    // matching the English fallback `isOtherLanguage` already applies above.
    const voiceId =
      scenario?.metadata?.languageVoices?.[languageId ?? enLanguageDetails?.id];
    if (!voiceId) {
      throw new BadRequestException(
        'Voice ID not found for scenario + language',
      );
    }

    if (scenario?.metadata) {
      scenario.metadata.voiceId = voiceId;
      scenario.metadata.language =
        languageDetails?.value ?? DEFAULT_LANGUAGE_CODE;
      scenario.metadata.languageId = languageId ?? enLanguageDetails?.id;
      scenario.metadata.defaultLanguageId = enLanguageDetails?.id;
    }

    const roomMetadata = await this.scenarioSharedService.createRoomMetadata({
      scenario,
      sessionEvents,
      languageDetails,
      previousMemory: trackPreviousMemory,
    });

    // Create a real session record so the run appears in session logs.
    const scenarioSession =
      await this.scenarioSessionRepository.createScenarioSession(userId, {
        scenarioId,
        languageId,
        voiceId,
        trackItemProgressId,
      });

    // Tag the session as a V2V test so it can be filtered downstream.
    scenarioSession.metadata = {
      ...(scenarioSession.metadata ?? {}),
      v2vTest: true,
      v2vMaxExchanges: maxExchanges,
    };
    await this.scenarioSessionRepository.save(scenarioSession);

    try {
      // Fetch-pointer metadata when enabled (see startScenarioSession).
      const { roomPayload, dispatchPayload } =
        await this.roomMetadataStoreService.prepareRoomMetadata(
          `${scenarioSession.roomId}`,
          roomMetadata,
        );

      // Create the LiveKit room and dispatch the counselor AI agent.
      await this.livekitService.createRoom({
        name: `${scenarioSession.roomId}`,
        ttl: DEFAULT_SCENARIO_SESSION_TTL_SECONDS,
        metadata: roomPayload,
      });

      this.livekitService.preMarkProactiveDispatch(`${scenarioSession.roomId}`);
      this.livekitService
        .agentDispatch(
          `${scenarioSession.roomId}`,
          this.configService.livekit.agentName,
          JSON.stringify(dispatchPayload),
        )
        .catch((err) => {
          this.livekitService.clearProactiveDispatch(
            `${scenarioSession.roomId}`,
          );
          this.logger.warn(
            `V2V: proactive agent dispatch failed: ${err?.message}`,
          );
        });

      // Generate a LiveKit token for the tester bot participant.
      const { token: testerToken } =
        await this.livekitService.generateAccessToken({
          roomName: `${scenarioSession.roomId}`,
          participantName: 'v2v-tester-bot',
          participantIdentity: `v2v-tester-${scenarioSession.id}`,
        });

      // Start the simulated learner in ally-ai-learn (fire-and-forget).
      this.aiService
        .startV2VTester({
          roomName: `${scenarioSession.roomId}`,
          testerToken,
          maxExchanges,
          language: languageDetails?.value ?? DEFAULT_LANGUAGE_CODE,
          scenarioTitle: scenario.title ?? '',
          scenarioContext:
            (roomMetadata as Record<string, any>)?.character ?? '',
          scenarioSessionId: scenarioSession.id,
          counselorId: userId,
        })
        .catch((err) => {
          this.logger.error(`V2V: failed to start tester bot: ${err?.message}`);
        });

      return {
        scenarioSession,
        isTestSession: true,
        simulatedUserAgent: 'google-tts',
      };
    } catch (error) {
      await this.scenarioSessionRepository.delete(scenarioSession.id);
      throw error;
    }
  }
}
