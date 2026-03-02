import { In, Not, IsNull } from 'typeorm';
import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggerService } from 'src/logger/logger.service';
import { ScenariosRepository } from '../repository/scenario.repository';
import { Scenarios } from '../entity/scenarios.entity';
import { ScenarioSessionRepository } from '../repository/scenario-session.repository';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { ScenarioFilters } from '../type/scenario-filter.type';
import { GetAdminScenarioDto, GetScenarioDto } from '../dto/get-scenario.dto';
import { ScenarioTranslationsRepository } from '../repository/scenario-translations.repository';
import { Pagination } from 'src/common/type/common.type';
import { ScenarioSessionMessagesRepository } from '../repository/scenario-session-messages.repository';
import { ScenarioSessionMessages } from '../entity/scenario-session-messages.entity';
import { ScenarioSessionDetailsRepository } from '../repository/scenario-session-details.repository';
import { ScenarioSessionMessageTagsRepository } from '../repository/scenario-session-message-tags.repository';
import { MessageTagMapping } from '../type/scenario-message-tag.type';
import {
  SCENARIO_SESSION_PROMPTS_USE_CASE,
  SCENARIO_SESSION_TRANSLATABLE_FIELDS,
  STT_LLM_PROVIDER_CONFIG,
  SKILL_ICONS_S3_PREFIX,
} from '../constants/scenario-session.constants';
import { AppConfigService } from 'src/config/config.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { ScenarioStateInstruction } from '../type/scenario-state.type';
import { getScenarioStateConfigByDifficultyLevel } from '../util/scenario-state.util';
import {
  CreateRoomMetadataOptions,
  ScenarioDifficultyLevel,
} from '../type/scenario.type';
import { LanguageCode } from '../type/scenario-language-voice.type';
import { SessionEvents } from 'src/session-event/entity/session-events.entity';
import { ScenarioVoices } from '../entity/scenario-voices.entity';
import { ScenarioVoicesRepository } from '../repository/scenario-voices.repository';
import { SessionEventDetectionType } from 'src/session-event/enum/session-event-detection.enum';
import { extractEventIds } from 'src/session-event/util/session-event.util';
import { MAX_COMBINATION_EVENT_DEPTH } from 'src/session-event/constants/event.constant';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { DEFAULT_LANGUAGE_CODE } from 'src/language/constants/language.constant';
import { SessionEventSharedService } from 'src/session-event/service/session-event-shared.service';
import { ScenarioBehaviorInstructionRepository } from '../repository/scenario-behavior-instruction.repository';
import { ScenarioBehaviorInstructionBehaviorRepository } from '../repository/scenario-behavior-instruction-behavior.repository';
import { formattedScenarioBehaviorInstructionsResponse } from '../util/scenario-behavior-instructions.util';
import { Behavior } from '../entity/behavior.entity';
import { BehaviorRepository } from '../repository/behavior.repository';
import { BehaviorInstructionWithBehaviorsDto } from '../dto/behavior-instruction-response.dto';
import { ConversationalGuardrailsService } from 'src/conversational-guardrails/service/conversational-guardrails.service';
import { isEnglishLanguage } from '../util/scenario.util';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { ScenarioSessionSkillsResponseDto } from '../dto/scenario-session-skills-response.dto';
import {
  ScenarioEvaluationEmotionalMovementItem,
  ScenarioEvaluationSkillCoverageItem,
} from 'src/ai/dto/ai.response.dto';
import { formatBehaviorInstructionsForLivekitMetadata } from '../util/scenario-behavior-instructions.util';
import { CompetencyService } from './competency.service';
import { S3Service } from 'src/aws/service/s3.service';

@Injectable()
export class ScenarioSharedService {
  private readonly logger = LoggerService.getInstance(
    ScenarioSharedService.name,
  );
  constructor(
    private readonly scenariosRepository: ScenariosRepository,
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioTranslationsRepository: ScenarioTranslationsRepository,
    private scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private scenarioSessionDetailsRepository: ScenarioSessionDetailsRepository,
    private scenarioSessionMessageTagsRepository: ScenarioSessionMessageTagsRepository,
    private scenarioVoiceRepository: ScenarioVoicesRepository,
    private sessionEventSharedService: SessionEventSharedService,
    private sharedLanguageService: SharedLanguageService,
    private scenarioBehaviorInstructionRepository: ScenarioBehaviorInstructionRepository,
    private scenarioBehaviorInstructionBehaviorRepository: ScenarioBehaviorInstructionBehaviorRepository,
    private behaviorRepository: BehaviorRepository,
    private conversationalGuardrailsService: ConversationalGuardrailsService,
    private promptSharedService: PromptSharedService,
    private competencyService: CompetencyService,
    private configService: AppConfigService,
    private s3Service: S3Service,
  ) {}

  async getScenarioByIds(
    scenarioIds: number[],
    filters?: ScenarioFilters,
  ): Promise<Scenarios[]> {
    return this.scenariosRepository.findBy({
      id: In(scenarioIds),
      ...(filters?.status && { status: In([filters.status]) }),
    });
  }

  async getScenarioWithTriggerWarningsByIds(
    scenarioIds: number[],
  ): Promise<GetScenarioDto[]> {
    return this.scenariosRepository.getScenarioWithTriggerWarningsByIds(
      scenarioIds,
    );
  }

  async getScenarioById(scenarioId: number): Promise<Scenarios | null> {
    return this.scenariosRepository.findOne({
      where: { id: scenarioId },
    });
  }

  async getScenarioSessionById(
    scenarioSessionId: string,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId },
    });
  }

  async getScenarioSessionForUser(
    scenarioSessionId: string,
    userId: number,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionRepository.findOne({
      where: { id: scenarioSessionId, counselorId: userId },
    });
  }

  async getUniqueLanguagesFromScenarioTranslations(): Promise<number[]> {
    return this.scenarioTranslationsRepository.getUniqueLanguagesFromScenarioTranslations();
  }

  async getMessagesByScenarioSessionId(
    scenarioSessionId: string,
    pagination: Pagination,
    options?: { includeTags?: boolean },
  ): Promise<{
    messages: (ScenarioSessionMessages & { tags?: MessageTagMapping[] })[];
    count: number;
  }> {
    const [messages, count] =
      await this.scenarioSessionMessagesRepository.getMessagesByScenarioSessionId(
        scenarioSessionId,
        pagination,
      );

    if (!options?.includeTags) {
      return { messages, count };
    }

    const messageIds = messages.map((m) => m.id);
    const tagsByMessageId =
      await this.scenarioSessionMessageTagsRepository.getTagsByMessageIds(
        scenarioSessionId,
        messageIds,
      );

    const messagesWithTags = messages.map((m) => ({
      ...m,
      tags: tagsByMessageId.get(m.id) ?? [],
    }));

    return { messages: messagesWithTags, count };
  }

  async getMessagesByIds(
    messageIds: number[],
  ): Promise<ScenarioSessionMessages[]> {
    return this.scenarioSessionMessagesRepository.find({
      where: { id: In(messageIds) },
    });
  }
  async getPreviousScenarioSessionByCaseSessionItemId(
    caseSessionItemId: string,
  ) {
    return this.scenarioSessionRepository.findOne({
      where: { caseSessionItemId, score: Not(IsNull()) },
      order: { score: 'DESC' },
    });
  }

  async getScenarioSessionDetailsByScenarioSessionId(
    scenarioSessionId: string,
  ) {
    return this.scenarioSessionDetailsRepository.findOne({
      where: { scenarioSessionId },
    });
  }

  async getSessionGlimpseByScenarioSessionId(
    scenarioSessionId: string,
  ): Promise<string | null> {
    const scenarioSessionDetails =
      await this.scenarioSessionDetailsRepository.findOne({
        where: { scenarioSessionId },
      });
    if (!scenarioSessionDetails) {
      throw new NotFoundException('Scenario session details not found');
    }
    return scenarioSessionDetails.summary?.feedback?.sessionGlimpse;
  }

  // Used for scenario report generation
  async createMetadataForScenario(
    scenarioId: number,
    languageId: number,
  ): Promise<Record<string, any>> {
    const scenario = await this.getAdminScenario(scenarioId);

    const { enLanguageDetails, languageDetails } =
      await this.getLanguageDetailsForScenarioSession(languageId);

    // Check if language is not English
    const isOtherLanguage =
      languageId && enLanguageDetails && languageId !== enLanguageDetails.id;

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

    // To add language and languageId to scenario metadata
    if (scenario?.metadata) {
      scenario.metadata.language =
        languageDetails?.value ?? DEFAULT_LANGUAGE_CODE;
      scenario.metadata.languageId = languageId ?? enLanguageDetails?.id;

      // Added defaultLanguageId to metadata to avoid database calls and use it for translation checks in createRoomMetadata.
      scenario.metadata.defaultLanguageId = enLanguageDetails?.id;
    }

    return this.createRoomMetadata({
      scenario,
      sessionEvents,
      languageDetails,
    });
  }

  async createRoomMetadata(options: CreateRoomMetadataOptions) {
    const { scenario, sessionEvents, languageDetails, previousMemory } =
      options;
    const {
      metadata,
      terminationEvents,
      behaviorInstructions: scenarioBehaviorInstructions,
      ...scenarioDataWithoutMetadata
    } = scenario;

    const behaviorInstructions =
      scenarioBehaviorInstructions ??
      (await this.getBehaviorInstructionsByScenarioId(scenario.id));
    const formattedBehaviorInstructionForMetadata =
      formatBehaviorInstructionsForLivekitMetadata(behaviorInstructions ?? []);

    const { voiceId, promptData, langIsEnglish } =
      await this.getScenarioTranslationData(
        {
          ...metadata,
          title: scenario.title,
          description: scenario.description,
        },
        scenario.id,
      );

    const languageCode = metadata?.language as LanguageCode;

    if (previousMemory) {
      promptData.previousMemory = previousMemory;
    }

    if (scenario?.competency?.name) {
      promptData.competency = scenario.competency?.name;
    }

    if (metadata?.languageId) {
      const samples =
        metadata?.linguisticStyleSamples?.[String(metadata.languageId)];
      if (samples && Array.isArray(samples)) {
        promptData.languageDialogueSamples = samples;
      }
    }

    const scenarioData = {
      ...scenarioDataWithoutMetadata,
      // Ensure we have values even if not translated
      title: promptData?.title || scenario.title,
      description: promptData?.description || scenario.description,
      promptData: promptData,
    };
    const scenarioVoice = await this.getScenarioVoice(voiceId);

    const triggerEvents = new Set<string>();
    const eventMap = new Map<string, SessionEvents>();

    // Add initial session events to the map
    sessionEvents.forEach((event) => {
      triggerEvents.add(event.id);
      eventMap.set(event.id, event);
    });

    // Add termination event ID to be fetched if needed
    const idsToProcess = new Set<string>();
    if (terminationEvents && terminationEvents?.length > 0) {
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

      //TODO: use shared session event service
      const fetchedEvents =
        await this.sessionEventSharedService.findByIds(idsToFetch);

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

    const autoTerminationEvents = terminationEvents?.map((termEvent) => {
      return {
        id: termEvent?.eventId,
        terminationMessage: termEvent?.message,
      };
    });

    const stateConfig = getScenarioStateConfigByDifficultyLevel(
      scenario.difficultyLevel as ScenarioDifficultyLevel,
    );

    const formattedStateInstructions = metadata?.stateInstructions?.map(
      (stateItem: ScenarioStateInstruction) => {
        const stateConfigInfo = stateConfig.find(
          (state) => state?.stateId === stateItem.stateId,
        );
        return {
          stateId: stateItem.stateId,
          instruction: stateItem?.instruction,
          dialogues: stateItem?.dialogues,
          scoreUpper: stateConfigInfo?.scoreRange?.max,
          scoreLower: stateConfigInfo?.scoreRange?.min,
        };
      },
    );

    const guardrails =
      await this.conversationalGuardrailsService.getRandomGuardrailsForSession(
        langIsEnglish ? undefined : languageDetails?.id,
      );

    const prompts = await this.getPromptsForScenarioSession();
    scenarioData.promptData.prompts = prompts;

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
        autoTerminationEvents,
        stateInstructions: formattedStateInstructions,
        guardrails: guardrails,
        behaviorInstructions: formattedBehaviorInstructionForMetadata,
      },
    };
  }

  async getScenarioVoice(id: string): Promise<ScenarioVoices> {
    const scenarioVoice = await this.scenarioVoiceRepository.findOne({
      where: { id },
    });

    if (!scenarioVoice) {
      throw new NotFoundException('Scenario voice not found');
    }

    return scenarioVoice;
  }

  async getVoiceWithLanguageCode(voiceId: string) {
    const voice =
      await this.scenarioVoiceRepository.getVoiceWithLanguageCode(voiceId);

    if (!voice) {
      throw new NotFoundException('Scenario voice not found');
    }

    return {
      ...voice,
      config:
        typeof voice.config === 'string'
          ? JSON.parse(voice.config)
          : voice.config,
    };
  }

  private async getScenarioTranslationData(metadata: any, scenarioId: number) {
    const { voiceId, languageId, language, defaultLanguageId, ...promptData } =
      metadata ?? {};

    // If language is English (by languageId), return original data
    const langIsEnglish = isEnglishLanguage(
      languageId,
      language,
      defaultLanguageId,
    );

    if (langIsEnglish) {
      return {
        langIsEnglish,
        voiceId,
        promptData: {
          ...promptData,
          languageId,
          language,
        },
      };
    }

    // Fetch translation for non-English language
    const translations = await this.scenarioTranslationsRepository.findOne({
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
      langIsEnglish,
      voiceId,
      promptData: {
        ...promptData,
        languageId,
        language,
      },
    };
  }

  async getLanguageDetailsForScenarioSession(languageId: number | undefined) {
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

  async getAdminScenario(id: number): Promise<GetAdminScenarioDto> {
    const result = await this.scenariosRepository.getAdminScenarioById(id);

    if (!result) {
      throw new NotFoundException('Scenario not found');
    }

    if (result?.competencyId) {
      const competency = await this.competencyService.getCompetency(
        result.competencyId,
      );
      result.competency = competency;
    }

    const behaviorInstructions =
      await this.getBehaviorInstructionsByScenarioId(id);
    if (behaviorInstructions) {
      result.behaviorInstructions = behaviorInstructions;
    }

    if (result?.terminationEvents && result?.terminationEvents?.length > 0) {
      const terminationEvents = await Promise.all(
        result.terminationEvents.map(async (event) => {
          if (event.eventId) {
            const eventDetails =
              await this.sessionEventSharedService.findSessionEventById(
                event.eventId,
              );
            return { ...event, name: eventDetails?.name };
          }
          return event;
        }),
      );
      result.terminationEvents = terminationEvents;
    }

    return result;
  }

  /**
   * Retrieves all behavior instructions for a scenario along with their associated behaviors.
   * This method fetches instructions, their behavior mappings, and the full behavior details.
   *
   * @param scenarioId - The scenario ID to get behavior instructions for
   * @returns Response containing behavior instructions with their associated behaviors
   */
  async getBehaviorInstructionsByScenarioId(
    scenarioId: number,
  ): Promise<BehaviorInstructionWithBehaviorsDto[] | undefined> {
    const instructions =
      await this.scenarioBehaviorInstructionRepository.getByScenarioId(
        scenarioId,
      );

    if (instructions.length === 0) {
      return;
    }

    // Get all instruction IDs to fetch behavior mappings
    const instructionIds = instructions.map((inst) => inst.id);

    // Get all behavior mappings for these instructions
    const behaviorMappings =
      await this.scenarioBehaviorInstructionBehaviorRepository.getByInstructionIds(
        instructionIds,
      );

    // Collect all unique behavior IDs
    const behaviorIds = [
      ...new Set(behaviorMappings.map((mapping) => mapping.behaviorId)),
    ];

    // Fetch all behavior entities
    const behaviors = await this.getBehaviorsByIds(behaviorIds);

    const scenarioInstructionsMap =
      formattedScenarioBehaviorInstructionsResponse({
        behaviorInstructions: instructions,
        behaviorMappings: behaviorMappings,
        behaviors: behaviors,
      });

    return scenarioInstructionsMap;
  }

  async getBehaviorsByIds(ids: string[]): Promise<Behavior[]> {
    return this.behaviorRepository.getBehaviorsByIds(ids);
  }

  private async getPromptsForScenarioSession() {
    const prompts = await this.promptSharedService.getPromptsByOptions({
      useCase: [SCENARIO_SESSION_PROMPTS_USE_CASE],
    });

    if (prompts?.length == 0) {
      return {};
    }

    return prompts.reduce<Record<string, string>>((acc, prompt) => {
      acc[prompt.promptCode] = prompt.prompt;
      return acc;
    }, {});
  }

  async getScenarioSessionSkills(
    scenarioSessionId: string,
  ): Promise<ScenarioSessionSkillsResponseDto> {
    const scenarioSessionDetails =
      await this.scenarioSessionDetailsRepository.findOne({
        where: { scenarioSessionId },
      });
    if (!scenarioSessionDetails) {
      throw new NotFoundException('Scenario session details not found');
    }
    const feedback = scenarioSessionDetails.summary?.feedback;
    const bucket = this.configService.s3.assetsBucket;
    const region = this.configService.aws.region;
    const skillCoverage = (feedback?.skillCoverage ?? []).map(
      (item: ScenarioEvaluationSkillCoverageItem) => {
        const iconUrl =
          bucket && region
            ? this.s3Service.getS3Url(
                bucket,
                region,
                `${SKILL_ICONS_S3_PREFIX}${item.category}.svg`,
              )
            : '';
        return {
          category: item.category,
          percentage: item.percentage,
          iconUrl,
        };
      },
    );
    const emotionalMovement = Array.isArray(feedback?.emotionalMovement)
      ? feedback?.emotionalMovement.map(
          (item: ScenarioEvaluationEmotionalMovementItem) => ({
            messageId: item.message_id,
            level: item.level,
            startTime: item.start_time,
          }),
        )
      : [];
    return { skillCoverage, emotionalMovement };
  }
}
