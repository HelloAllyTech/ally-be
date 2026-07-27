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
  ALLY_AI_LEARN_PROMPT_PREFIX,
  SCENARIO_SESSION_TRANSLATABLE_FIELDS,
  STT_LLM_PROVIDER_CONFIG,
  SKILL_ICONS_S3_PREFIX,
  ROOM_METADATA_WARN_BYTES,
} from '../constants/scenario-session.constants';
import { AppConfigService } from 'src/config/config.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { getScenarioStateConfigByDifficultyLevel } from '../util/scenario-state.util';
import {
  CreateRoomMetadataOptions,
  ScenarioDifficultyLevel,
} from '../type/scenario.type';
import { LanguageCode } from '../type/scenario-language-voice.type';
import { LanguageCode as LanguageValueCode } from '../enum/scenario-language';
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
import {
  getActiveScenarioMandatoryFields,
  hydrateAdminScenarioFromVersionConfig,
  isEnglishLanguage,
  shouldServeMultilingual,
} from '../util/scenario.util';
import { ScenarioVersionRepository } from '../repository/scenario-version.repository';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { PromptTranslationService } from 'src/prompt/service/prompt-translation.service';
import { Languages } from 'src/language/entity/languages.entity';
import { LanguageGlossaryService } from 'src/language/service/language-glossary.service';
import { ScenarioSessionSkillsResponseDto } from '../dto/scenario-session-skills-response.dto';
import {
  ScenarioEvaluationEmotionalMovementItem,
  ScenarioEvaluationSkillCoverageItem,
} from 'src/ai/dto/ai.response.dto';
import { formatBehaviorInstructionsForLivekitMetadata } from '../util/scenario-behavior-instructions.util';
import { BehaviorInstructionCategory } from '../enum/behavior-instruction.enum';
import { CompetencyService } from './competency.service';
import { S3Service } from 'src/aws/service/s3.service';
import { htmlToPlainText } from 'src/common/util/sanitize-html.util';
import { ScenarioSessionRecordingRepository } from '../repository/scenario-session-recording.repository';
import { ScenarioSessionRecording } from '../entity/scenario-session-recording.entity';

/**
 * scenario_translations.metadata.openingStatements may be string[] (current) or a legacy /
 * externally-written string. Session merge accepts both; admin must normalize so tabs hydrate.
 */
function normalizeTranslationOpeningStatementsLines(raw: unknown): string[] {
  if (raw == null) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((l) => String(l).trim()).filter((l) => l.length > 0);
  }
  if (typeof raw === 'string') {
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }
  return [];
}

function parseScenarioTranslationMetadata(
  metadata: unknown,
): Record<string, unknown> {
  if (metadata == null) {
    return {};
  }
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as unknown;
      return typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }
  return {};
}

@Injectable()
export class ScenarioSharedService {
  private readonly logger = LoggerService.getInstance(
    ScenarioSharedService.name,
  );
  constructor(
    private readonly scenariosRepository: ScenariosRepository,
    private readonly scenarioVersionRepository: ScenarioVersionRepository,
    private scenarioSessionRepository: ScenarioSessionRepository,
    private scenarioTranslationsRepository: ScenarioTranslationsRepository,
    private scenarioSessionMessagesRepository: ScenarioSessionMessagesRepository,
    private scenarioSessionDetailsRepository: ScenarioSessionDetailsRepository,
    private scenarioSessionMessageTagsRepository: ScenarioSessionMessageTagsRepository,
    private scenarioVoiceRepository: ScenarioVoicesRepository,
    private scenarioSessionRecordingRepository: ScenarioSessionRecordingRepository,
    private sessionEventSharedService: SessionEventSharedService,
    private sharedLanguageService: SharedLanguageService,
    private scenarioBehaviorInstructionRepository: ScenarioBehaviorInstructionRepository,
    private scenarioBehaviorInstructionBehaviorRepository: ScenarioBehaviorInstructionBehaviorRepository,
    private behaviorRepository: BehaviorRepository,
    private conversationalGuardrailsService: ConversationalGuardrailsService,
    private promptSharedService: PromptSharedService,
    private promptTranslationService: PromptTranslationService,
    private languageGlossaryService: LanguageGlossaryService,
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

  hasAllActiveScenarioMandatoryFields(item: any): boolean {
    const metadata = item.scenario_metadata ?? item.metadata ?? {};
    const ACTIVE_SCENARIO_MANDATORY_FIELDS = getActiveScenarioMandatoryFields();

    const missingFields = ACTIVE_SCENARIO_MANDATORY_FIELDS.filter((field) => {
      if (field === 'behaviorInstructions') {
        const instructions =
          item.behaviorInstructions ?? item.scenario_behaviorInstructions;
        return (
          !instructions ||
          (Array.isArray(instructions) && instructions.length === 0)
        );
      }
      const value = metadata[field] ?? item[`scenario_${field}`] ?? item[field];

      if (value === null || value === undefined) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      if (Array.isArray(value) && value.length === 0) return true;

      return false;
    });

    if (missingFields.length > 0) {
      this.logger.warn(
        `Missing mandatory fields for scenario ${item?.scenario_id ?? item?.id ?? 'unknown'}: ${missingFields.join(', ')}`,
      );
    }

    return missingFields.length === 0;
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
    if (!messageIds) {
      return [];
    }
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

  // Used for scenario report generation. `scenarioOverride` lets a draft
  // version's hydrated config drive the run instead of the live scenario;
  // when omitted, behaviour is unchanged (reads the live scenario).
  async createMetadataForScenario(
    scenarioId: number,
    languageId: number,
    scenarioOverride?: GetAdminScenarioDto,
  ): Promise<Record<string, any>> {
    const scenario =
      scenarioOverride ?? (await this.getAdminScenario(scenarioId));

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

    const { voiceId, promptData } = await this.getScenarioTranslationData(
      {
        ...metadata,
        title: scenario.title,
        description: scenario.description,
      },
      scenario.id,
    );

    const languageCode = metadata?.language as LanguageCode;

    // Pre-format previousMemory into the final sentence here so the
    // ai-learn prompt template can substitute `{previous_memory}`
    // verbatim with no conditional wrapper. Either we send a complete
    // "You remember from your last session: …" block or an empty
    // string — keeps the template body identical for session-1 and
    // session-N+1 cases.
    if (previousMemory && previousMemory.trim()) {
      promptData.previousMemory = `You remember from your last session: ${previousMemory.trim()}.`;
    } else {
      promptData.previousMemory = '';
    }

    if (scenario?.prompt) {
      promptData.roleInstructions = scenario.prompt;
    }

    if (scenario?.competency?.name) {
      promptData.competency = scenario.competency?.name;
    }

    // Drop per-language maps; learn payload uses same key as scenario API but
    // carries the active language's value only (see create-scenario DTO).
    delete promptData.allowedFillerWords;
    delete promptData.languageCharacteristics;

    // Human-readable language name (e.g. "Tamil (India)") — gives the LLM a far
    // stronger dialect signal than the bare BCP-47 code alone.
    if (languageDetails?.label) {
      promptData.languageLabel = languageDetails.label;
    }

    // Tier 0 language-glossary style card (LANGUAGE_GLOSSARY_DESIGN.md §5.1):
    // compiled from published always-sections, language-level, ~1-2k tokens.
    // Publishing a section is the rollout gate — no published content, no block.
    // English sessions skip entirely; a glossary failure never blocks a session.
    if (languageDetails?.id && !languageDetails.value?.startsWith('en')) {
      try {
        const glossary =
          await this.languageGlossaryService.resolveTier0Glossary(
            languageDetails.id,
          );
        if (glossary) {
          promptData.languageGlossary = glossary;
        }
      } catch (error) {
        this.logger.warn(
          `[GLOSSARY] Tier 0 resolution failed for language ${languageDetails.id}; serving without glossary: ${error}`,
        );
      }

      // Tier 1 (LANGUAGE_GLOSSARY_DESIGN.md §5.2): published retrieved-mode
      // sections join the agent's knowledge-retrieval title selection. Titles
      // are prefixed so the selector (and logs) can tell glossary sections
      // from scenario knowledge; retrievalHint rides along as the "when to
      // pull this" trigger description.
      try {
        const tier1 = await this.languageGlossaryService.resolveTier1Sections(
          languageDetails.id,
        );
        if (tier1.length > 0) {
          const label = languageDetails.label || 'Language';
          promptData.glossarySections = tier1.map((s) => ({
            ...s,
            title: `[${label} glossary] ${s.title}`,
          }));
        }
      } catch (error) {
        this.logger.warn(
          `[GLOSSARY] Tier 1 resolution failed for language ${languageDetails.id}; serving without glossary sections: ${error}`,
        );
      }
    }

    if (metadata?.languageId) {
      const samples =
        metadata?.linguisticStyleSamples?.[String(metadata.languageId)];
      if (samples && Array.isArray(samples)) {
        promptData.languageDialogueSamples = samples;
      }

      const fillers =
        metadata?.allowedFillerWords?.[String(metadata.languageId)];
      if (fillers && Array.isArray(fillers)) {
        const cleaned = fillers
          .map((f) => (typeof f === 'string' ? f.trim() : ''))
          .filter((f) => f.length > 0);
        if (cleaned.length > 0) {
          promptData.allowedFillerWords = cleaned;
        }
      }

      // Free-text per-language style guidance for this scenario, authored in
      // studio (e.g. "Speaks simple, colloquial Chennai Tamil; code-mixes with
      // English"). Optional; defaults to blank. Shape mirrors the sibling maps
      // above — keyed by languageId, scoped to the active language only.
      const characteristics =
        metadata?.languageCharacteristics?.[String(metadata.languageId)];
      if (typeof characteristics === 'string') {
        const trimmed = characteristics.trim();
        if (trimmed.length > 0) {
          promptData.languageCharacteristics = trimmed;
        }
      }
    }

    const translatedDescription =
      scenarioDataWithoutMetadata?.translationDescription?.[
        metadata?.languageId
      ];
    promptData.description =
      translatedDescription != null
        ? htmlToPlainText(translatedDescription)
        : scenarioDataWithoutMetadata.description;
    delete scenarioDataWithoutMetadata.translationDescription;

    // Pre-compute helpful/unhelpful behaviour lists so ai-learn reads them
    // directly instead of filtering behaviorInstructions by category each turn.
    promptData.helpfulBehaviours = formattedBehaviorInstructionForMetadata
      .filter((b) => b.category === BehaviorInstructionCategory.SHOULD_DO)
      .flatMap((b) => b.behaviors);
    promptData.unhelpfulBehaviours = formattedBehaviorInstructionForMetadata
      .filter((b) => b.category === BehaviorInstructionCategory.SHOULD_NOT_DO)
      .flatMap((b) => b.behaviors);

    // Pre-sort states by scoreLower (ascending) so ai-learn's per-turn resolver
    // can skip re-sorting. The starting state is emergent (the resolver opens
    // in whichever range contains score 0), so there is no defaultStateId to
    // pre-compute.
    if (Array.isArray(promptData.states) && promptData.states.length > 0) {
      promptData.states = [...promptData.states].sort(
        (a: any, b: any) => (a.scoreLower ?? 0) - (b.scoreLower ?? 0),
      );
    }

    const scenarioData = {
      ...scenarioDataWithoutMetadata,
      // Ensure we have values even if not translated
      title: promptData?.title || scenario.title,
      description:
        promptData?.description || scenarioDataWithoutMetadata.description,
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
    const formattedStateInstructions = stateConfig.map((state) => ({
      stateId: state.stateId,
      scoreUpper: state.scoreRange.max,
      scoreLower: state.scoreRange.min,
    }));

    const guardrails =
      await this.conversationalGuardrailsService.getRandomGuardrailsForSession();

    const prompts = await this.getPromptsForScenarioSession(
      languageDetails,
      metadata?.mainPromptVariantByLanguage as
        | Record<string, string>
        | undefined,
    );
    scenarioData.promptData.prompts = prompts;

    const roomMetadata = {
      version: '1.0',
      tenantId: ExecutionManager.getTenantId(),
      environment: this.configService.livekit.environment,
      scenario: {
        ...scenarioData,
        // Surface metadata flags the agent reads top-level (raw.get(...)).
        // pauseEnabled drives the agent's defense-in-depth pause gate.
        pauseEnabled: metadata?.pauseEnabled,
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
        guardrailsPrompt: guardrails.prompt,
        guardrails: guardrails.items,
        behaviorInstructions: formattedBehaviorInstructionForMetadata,
      },
    };

    // LiveKit caps room metadata at 64 KiB and nothing here trims — surface the
    // payload size so headroom is visible before it becomes a session failure
    // (LANGUAGE_GLOSSARY_DESIGN.md edge case 11). Session-start only.
    const metadataBytes = Buffer.byteLength(
      JSON.stringify(roomMetadata),
      'utf8',
    );
    if (metadataBytes > ROOM_METADATA_WARN_BYTES) {
      this.logger.warn(
        `[ROOM_METADATA_SIZE] ${metadataBytes} bytes (warn threshold ${ROOM_METADATA_WARN_BYTES}, LiveKit cap 65536) scenario=${scenario.id}`,
      );
    } else {
      this.logger.info(
        `[ROOM_METADATA_SIZE] ${metadataBytes} bytes scenario=${scenario.id}`,
      );
    }

    return roomMetadata;
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
    // Pin the canonical English row to en-IN by `value` (unique). Looking up
    // by translationCode='en' is ambiguous now that en-IN, en-GB, and en-US
    // all share that code — Postgres heap order would decide the winner and
    // mis-classify en-IN sessions as "non-English" when the wrong row is
    // returned.
    const enLanguageDetails =
      await this.sharedLanguageService.getLanguageByValue(
        LanguageValueCode.EN_IN,
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

    const translationRows =
      await this.scenarioTranslationsRepository.getScenarioTranslationsByScenarioId(
        id,
      );
    const translationOpeningStatements: Record<string, string[]> = {};
    const translationDescription: Record<string, string> = {};
    const translationTitle: Record<string, string> = {};
    const translationReminders: Record<string, string[]> = {};
    for (const row of translationRows ?? []) {
      const meta = parseScenarioTranslationMetadata(row.metadata);
      const cleaned = normalizeTranslationOpeningStatementsLines(
        meta.openingStatements,
      );
      if (cleaned.length > 0) {
        translationOpeningStatements[String(row.languageId)] = cleaned;
      }
      const desc = meta.description;
      if (typeof desc === 'string' && desc.trim().length > 0) {
        translationDescription[String(row.languageId)] = desc;
      }
      const title = meta.title;
      if (typeof title === 'string' && title.trim().length > 0) {
        translationTitle[String(row.languageId)] = title;
      }
      const cleanedReminders = normalizeTranslationOpeningStatementsLines(
        meta.reminders,
      );
      if (cleanedReminders.length > 0) {
        translationReminders[String(row.languageId)] = cleanedReminders;
      }
    }
    const primaryLanguageId =
      await this.resolveOpeningDialoguePrimaryLanguageId(result.metadata);
    (result as GetAdminScenarioDto).translationOpeningStatements =
      translationOpeningStatements;
    (result as GetAdminScenarioDto).openingDialoguePrimaryLanguageId =
      primaryLanguageId;
    (result as GetAdminScenarioDto).translationDescription =
      translationDescription;
    (result as GetAdminScenarioDto).challengeDescriptionPrimaryLanguageId =
      primaryLanguageId;
    (result as GetAdminScenarioDto).translationTitle = translationTitle;
    (result as GetAdminScenarioDto).translationReminders = translationReminders;
    (result as GetAdminScenarioDto).remindersPrimaryLanguageId =
      primaryLanguageId;

    return result;
  }

  /**
   * Build a form-shaped admin scenario from a saved version's config, overlaid
   * on the live scenario. Used to run a draft version's report/preview without
   * publishing it. Throws if the version doesn't belong to the scenario.
   */
  async buildScenarioOverrideFromVersion(
    scenarioId: number,
    versionId: string,
    base?: GetAdminScenarioDto,
  ): Promise<GetAdminScenarioDto> {
    const version = await this.scenarioVersionRepository.findOne({
      where: { id: versionId, scenarioId },
    });
    if (!version) {
      throw new NotFoundException('Scenario version not found');
    }
    const baseScenario = base ?? (await this.getAdminScenario(scenarioId));
    return hydrateAdminScenarioFromVersionConfig(
      baseScenario,
      version.config ?? {},
    );
  }

  async resolveOpeningDialoguePrimaryLanguageId(
    metadata?: Record<string, any> | null,
  ): Promise<number | null> {
    if (metadata?.defaultLanguageId != null) {
      return Number(metadata.defaultLanguageId);
    }
    // Old scenarios (no defaultLanguageId in metadata) had their primary
    // openingStatements authored under English (India). Pin the fallback to
    // en-IN by `value` — looking up by translationCode='en' is ambiguous now
    // that en-IN, en-GB, and en-US all share that code, and which row wins
    // depends on Postgres heap order.
    const enIn = await this.sharedLanguageService.getLanguageByValue(
      LanguageValueCode.EN_IN,
    );
    return enIn?.id ?? null;
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

  /**
   * Get prompts for scenario session metadata.
   * Only includes prompts with useDashboardOverride=true (enabled from Dashboard).
   * ally-ai-learn uses metadata prompts when present; otherwise falls back to local .txt.
   */
  /**
   * Resolve the *versions* of the dashboard-override prompts that drive a
   * scenario session, as { promptCode: currentVersion }. Stamped onto the
   * session at start so drift analytics can attribute behaviour to a specific
   * prompt-version experiment. Best-effort: returns {} on any failure (capture
   * must never block session start).
   */
  async getResolvedPromptVersionsForScenarioSession(): Promise<
    Record<string, number>
  > {
    try {
      const prompts = await this.promptSharedService.getPromptsByOptions({
        promptCodePrefix: ALLY_AI_LEARN_PROMPT_PREFIX,
        useDashboardOverrideOnly: true,
      });
      return (prompts ?? []).reduce<Record<string, number>>((acc, p) => {
        const version = (p as { currentVersion?: number }).currentVersion;
        if (version != null) {
          acc[p.promptCode] = version;
        }
        return acc;
      }, {});
    } catch {
      return {};
    }
  }

  private async getPromptsForScenarioSession(
    languageDetails?: Languages | null,
    variantByLanguage?: Record<string, string> | null,
  ) {
    const prompts = await this.promptSharedService.getPromptsByOptions({
      promptCodePrefix: ALLY_AI_LEARN_PROMPT_PREFIX,
      useDashboardOverrideOnly: true,
    });

    if (prompts?.length == 0) {
      return {};
    }

    // Only include prompts with non-empty content so ally-ai-learn uses dashboard edits.
    // Also forwards hasStates so ai-learn knows when to resolve simulation states.
    const result = prompts.reduce<
      Record<
        string,
        {
          prompt: string;
          availableVariables?: (
            | string
            | { name: string; label?: string; required?: boolean }
          )[];
          hasStates?: boolean;
          provider?: string;
          model?: string;
          temperature?: number;
        }
      >
    >((acc, prompt) => {
      const content = prompt.prompt?.trim();
      if (content) {
        acc[prompt.promptCode] = {
          prompt: content,
          availableVariables: prompt.availableVariables || [],
          hasStates: prompt.hasStates ?? false,
          // Forward the prompt-level LLM overrides so the voice runtime
          // (ai-learn's get_prompt_llm_overrides) can honor a per-prompt
          // provider/model/temperature. Only include when set so the payload
          // stays clean and the runtime falls back to its code default.
          ...(prompt.provider ? { provider: prompt.provider } : {}),
          ...(prompt.model ? { model: prompt.model } : {}),
          ...(typeof prompt.temperature === 'number'
            ? { temperature: prompt.temperature }
            : {}),
        };
      }
      return acc;
    }, {});

    // Observability: log which shipped prompts carry a per-prompt LLM override,
    // so the voice runtime's chosen provider/model/temperature is traceable from
    // the ally-be side (mirrors ai-learn's `[LLM] applying overrides` log).
    const withOverrides = Object.entries(result)
      .filter(([, p]) => p.provider || p.model || p.temperature != null)
      .map(
        ([code, p]) =>
          `${code}(provider=${p.provider ?? '-'} model=${p.model ?? '-'} temperature=${p.temperature ?? '-'})`,
      );
    this.logger.info(
      `[SESSION_PROMPTS] shipping ${Object.keys(result).length} prompts to ai-learn; ` +
        `${withOverrides.length} with LLM override: ${withOverrides.join(', ') || 'none'}`,
    );

    // For a non-English session, overlay translated bodies where a fresh
    // translation exists — but ONLY when the simulation opted this language into
    // the MULTILINGUAL variant. GENERIC (or unset) ships the English body so the
    // model speaks the target language from the source prompt (today's default).
    // Anything not translated stays English (ai-learn treats any non-empty body
    // as authoritative). Skipped entirely for English/default sessions.
    if (shouldServeMultilingual(languageDetails, variantByLanguage)) {
      const englishByCode = Object.fromEntries(
        Object.entries(result).map(([code, value]) => [code, value.prompt]),
      );
      const overlaid = await this.promptTranslationService.overlayTranslations(
        englishByCode,
        languageDetails!.id!,
      );
      for (const code of Object.keys(result)) {
        const o = overlaid[code];
        if (!o) continue;
        if (o.body && o.body !== result[code].prompt) {
          result[code].prompt = o.body;
        }
        // Per-language runtime engine override for the served translated body:
        // which model runs the main agent for this language. Only set when a
        // translation was served AND a runtime model is configured.
        if (o.runtimeModel) {
          result[code].model = o.runtimeModel;
          if (o.runtimeProvider) result[code].provider = o.runtimeProvider;
        }
      }
    }

    return result;
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

  async saveScenarioSessionRecording(data: {
    scenarioSessionId: string;
    storageKey: string;
    tenantId: string;
    egressId: string;
  }): Promise<ScenarioSessionRecording> {
    const recording = this.scenarioSessionRecordingRepository.create({
      scenarioSessionId: data.scenarioSessionId,
      storageKey: data.storageKey,
      tenantId: data.tenantId,
      egressId: data.egressId,
    });

    return this.scenarioSessionRecordingRepository.save(recording);
  }

  async getScenarioSessionRecordingBySessionId(
    scenarioSessionId: string,
  ): Promise<ScenarioSessionRecording | null> {
    return this.scenarioSessionRecordingRepository.findOne({
      where: { scenarioSessionId },
    });
  }
}
