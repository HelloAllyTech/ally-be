import { DeepPartial } from 'typeorm';
import { SCENARIO_MANDATORY_FIELDS } from '../constants/scenario-mandatory-fields.constants';
import {
  DEFAULT_LANGUAGE_TRANSLATION_CODE,
  LOCAL_LLM_PROVIDERS,
} from '../constants/scenario-session.constants';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { Scenarios } from '../entity/scenarios.entity';
import { ExperienceMode, ChecklistType } from '../type/scenario.type';
import { GetAdminScenarioDto } from '../dto/get-scenario.dto';

/**
 * Scenario fields persisted on `scenarios.metadata` (vs. dedicated columns).
 * Single source of truth shared by the DTO→entity mapper and the version
 * config↔scenario hydration so the two never drift.
 */
export const SCENARIO_METADATA_FIELDS: (keyof UpdateScenarioDto)[] = [
  'name',
  'age',
  'gender',
  'genderIdentity',
  'sexualOrientation',
  'currentLocation',
  'profession',
  'openingStatements',
  'reminders',
  'temperature',
  'fillerEnabled',
  'languageGlossaryEnabled',
  'comfortAudioEnabled',
  'comfortAudioUrl',
  'comfortAudioVolume',
  'historyTrimEnabled',
  // EXPERIMENT(turn-endpointing) — temporary per-sim pair
  'turnMinEndpointingDelay',
  'turnMaxEndpointingDelay',
  'continuousBackchanneling',
  'interimReplyEnabled',
  'customFields',
  'languageVoices',
  'sttConfigByLanguage',
  'linguisticStyleSamples',
  'allowedFillerWords',
  'languageCharacteristics',
  'experienceMode',
  'checklistType',
  'summaryChecklistEnabled',
  'timerMode',
  'maxTimeValue',
  'optGuardrails',
  'characterProfileText',
  'helperAgentPrompt',
  'agentBuilderDescription',
  'agentBuilderPrompt',
  'showScoreMeter',
  'enableFeedback',
  'feedbackTabs',
  'supervisorNotesEnabled',
  'liveTabEnabled',
  'pauseEnabled',
  'currentState',
  'remindersEnabled',
  'knowledgeSources',
  'stateNames',
  'selectedMainPromptCode',
  'selectedEvaluatorPromptCode',
  'mainPromptVariantByLanguage',
  'states',
  'agentTestCaseIds',
];

/** Scenario fields persisted as dedicated `scenarios` columns. */
export const SCENARIO_ROOT_FIELDS: (keyof UpdateScenarioDto)[] = [
  'title',
  'description',
  'coverImageUrl',
  'coverVideoUrl',
  'status',
  'isPublic',
  'prompt',
  'isGlobal',
  'difficultyLevel',
  'competencyId',
  'category',
  'partnerOrgName',
];

/**
 * Rebuild a form-shaped admin scenario (the shape `createRoomMetadata`
 * consumes) from a flattened version `config`, overlaid on a live `base`
 * scenario. The base supplies identity/competency/translation maps that aren't
 * part of the editable snapshot; `config` overrides everything editable.
 *
 * NOTE: session events and scenario_translations are keyed by scenarioId in
 * their own tables, so a draft test run still reflects the live scenario's
 * events/translations — only the editable form surface comes from the draft.
 */
export const hydrateAdminScenarioFromVersionConfig = (
  base: GetAdminScenarioDto,
  config: Record<string, any>,
): GetAdminScenarioDto => {
  const metadata: Record<string, any> = { ...(base.metadata ?? {}) };
  for (const field of SCENARIO_METADATA_FIELDS) {
    if (config[field] !== undefined) {
      metadata[field] = config[field];
    }
  }

  const hydrated = { ...base, metadata } as GetAdminScenarioDto;
  for (const field of SCENARIO_ROOT_FIELDS) {
    if (config[field] !== undefined) {
      (hydrated as Record<string, any>)[field] = config[field];
    }
  }
  if (config.terminationEvents !== undefined) {
    hydrated.terminationEvents = config.terminationEvents;
  }
  if (config.behaviorInstructions !== undefined) {
    hydrated.behaviorInstructions = config.behaviorInstructions;
  }
  return hydrated;
};

export const mapCreateScenarioRequestToEntity = (
  scenario: CreateScenarioDto,
  userId: number,
) => {
  return {
    createdBy: userId,
    updatedBy: userId,
    title: scenario.title,
    scenario: '',
    description: scenario.description,
    coverImageUrl: scenario.coverImageUrl,
    coverVideoUrl: scenario.coverVideoUrl,
    status: scenario.status,
    isPublic: scenario.isPublic,
    prompt: scenario.prompt,
    isGlobal: scenario.isGlobal,
    difficultyLevel: scenario.difficultyLevel,
    competencyId: scenario.competencyId,
    category: scenario.category,
    partnerOrgName: scenario.partnerOrgName,
    metadata: {
      name: scenario.name,
      age: scenario.age,
      gender: scenario.gender,
      genderIdentity: scenario.genderIdentity,
      sexualOrientation: scenario.sexualOrientation,
      currentLocation: scenario.currentLocation,
      profession: scenario.profession,
      openingStatements: scenario.openingStatements,
      reminders: scenario.reminders,
      temperature: scenario.temperature,
      fillerEnabled: scenario.fillerEnabled ?? true,
      languageGlossaryEnabled: scenario.languageGlossaryEnabled,
      comfortAudioEnabled: scenario.comfortAudioEnabled,
      comfortAudioUrl: scenario.comfortAudioUrl,
      comfortAudioVolume: scenario.comfortAudioVolume,
      historyTrimEnabled: scenario.historyTrimEnabled,
      // EXPERIMENT(turn-endpointing) — temporary per-sim pair
      turnMinEndpointingDelay: scenario.turnMinEndpointingDelay,
      turnMaxEndpointingDelay: scenario.turnMaxEndpointingDelay,
      continuousBackchanneling: scenario.continuousBackchanneling,
      interimReplyEnabled: scenario.interimReplyEnabled,
      customFields: scenario.customFields?.map((customField) => ({
        name: customField.name,
        value: customField.value,
        useInDefaultPrompt: customField.useInDefaultPrompt ?? true,
      })),
      languageVoices: scenario.languageVoices,
      sttConfigByLanguage: scenario.sttConfigByLanguage,
      linguisticStyleSamples: scenario.linguisticStyleSamples,
      allowedFillerWords: scenario.allowedFillerWords,
      languageCharacteristics: scenario.languageCharacteristics,
      experienceMode: scenario.experienceMode,
      ...(scenario.experienceMode === ExperienceMode.CHECKLIST && {
        checklistType: scenario.checklistType || ChecklistType.GUIDED,
        // Opt-in per roleplay: a new checklist scenario never shows the
        // checklist on the learner's summary until an author turns it on.
        summaryChecklistEnabled: scenario.summaryChecklistEnabled === true,
      }),
      timerMode: scenario.timerMode,
      ...(scenario.timerMode === true && {
        maxTimeValue: scenario.maxTimeValue,
      }),
      optGuardrails: scenario.optGuardrails,
      characterProfileText: scenario.characterProfileText,
      helperAgentPrompt: scenario.helperAgentPrompt,
      agentBuilderDescription: scenario.agentBuilderDescription,
      agentBuilderPrompt: scenario.agentBuilderPrompt,
      showScoreMeter: scenario.showScoreMeter,
      enableFeedback: scenario.enableFeedback,
      feedbackTabs: scenario.feedbackTabs,
      // Opt-in per roleplay: the supervisor stays silent during a session
      // until an author turns the live notes on.
      supervisorNotesEnabled: scenario.supervisorNotesEnabled === true,
      // Opt-out per roleplay: the learner's Live tab stays on unless an
      // author explicitly disables it.
      liveTabEnabled: scenario.liveTabEnabled,
      pauseEnabled: scenario.pauseEnabled,
      currentState: scenario.currentState,
      remindersEnabled: scenario.remindersEnabled,
      knowledgeSources: scenario.knowledgeSources?.map((knowledgeSource) => ({
        id: knowledgeSource.id,
        title: knowledgeSource.title,
        content: knowledgeSource.content,
      })),
      stateNames: scenario.stateNames,
      selectedMainPromptCode: scenario.selectedMainPromptCode,
      selectedEvaluatorPromptCode: scenario.selectedEvaluatorPromptCode,
      mainPromptVariantByLanguage: scenario.mainPromptVariantByLanguage,
      states: scenario.states,
      agentTestCaseIds: scenario.agentTestCaseIds,
    },
  };
};

export const formatAutoTerminationEventsList = (
  createScenariosDto: CreateScenariosDto,
  savedScenarios: Scenarios[],
) => {
  return savedScenarios.flatMap((savedScenario, index) => {
    const correspondingDto = createScenariosDto.scenarios[index];
    return (
      correspondingDto.terminationEvents?.map((terminationEvent) => ({
        scenarioId: savedScenario.id,
        eventId: terminationEvent.id,
        autoTerminationStatus: true,
        message: terminationEvent.message,
      })) ?? []
    );
  });
};

export const formatScenarioTriggerWarningsList = (
  createScenariosDto: CreateScenariosDto,
  savedScenarios: Scenarios[],
) =>
  savedScenarios.flatMap((savedScenario, index) => {
    const correspondingDto = createScenariosDto.scenarios[index];
    const triggerWarningIds = [
      ...new Set(correspondingDto.triggerWarningIds || []),
    ];
    return triggerWarningIds.map((triggerWarningId) => ({
      scenarioId: savedScenario.id,
      triggerWarningId,
    }));
  });

export const getActiveScenarioMandatoryFields = () => SCENARIO_MANDATORY_FIELDS;

/**
 * Decide whether a session should be served the MULTILINGUAL (translated)
 * main-agent/branching bodies rather than the English source. MULTILINGUAL is
 * now the DEFAULT for every non-source language (fail-and-fix-early rollout,
 * validated via automated v2v baselines); an explicit 'GENERIC' entry is the
 * per-language escape hatch, editable by SUPER_DUPER_ADMIN only (enforced in
 * ScenarioService create/update). This is safe for untranslated content: the
 * overlay serves the English body for any prompt without a translation, so
 * the worst case equals the old default. English/unknown languages always
 * serve the source prompts.
 */
export const shouldServeMultilingual = (
  languageDetails: { id?: number; translationCode?: string } | null | undefined,
  variantByLanguage: Record<string, string> | null | undefined,
): boolean => {
  if (!languageDetails?.id) return false;
  if (languageDetails.translationCode === DEFAULT_LANGUAGE_TRANSLATION_CODE) {
    return false;
  }
  return variantByLanguage?.[String(languageDetails.id)] !== 'GENERIC';
};

/** A resolved registry row, reduced to what the agent actually consumes. */
export interface ResolvedProviderConfig {
  provider: string;
  config: Record<string, any>;
}

type RegistryRow = { provider?: string; config?: Record<string, any> };

/**
 * Reduce an stt_configs registry row to the `{ provider, config }` shape
 * ally-ai-learn expects, or null when the row can't produce a working client.
 *
 * A row missing a model is treated as unusable rather than passed through: the
 * agent's `create_stt_client` would pair the chosen provider with the *platform
 * default* model (Deepgram's "nova-3"), so an ElevenLabs row with no model
 * yields an ElevenLabs client asking for a Deepgram model — a session that
 * starts and transcribes nothing. Falling back is the safe read.
 */
export const toResolvedSttConfig = (
  row: RegistryRow | null | undefined,
): ResolvedProviderConfig | null => {
  if (!row?.provider || !row?.config?.model) return null;
  return { provider: row.provider, config: row.config };
};

/**
 * Same reduction for an llm_configs row. The model requirement is conditional:
 * Ollama and vLLM serve whatever the server is running, so a missing model is
 * legitimate there. For hosted providers it is the same trap as STT — the agent
 * would pair the chosen provider with `gpt-4o-mini`.
 */
export const toResolvedLlmConfig = (
  row: RegistryRow | null | undefined,
): ResolvedProviderConfig | null => {
  if (!row?.provider) return null;
  const isLocal = LOCAL_LLM_PROVIDERS.includes(row.provider.toLowerCase());
  if (!isLocal && !row?.config?.model) return null;
  return { provider: row.provider, config: row.config ?? {} };
};

/**
 * Shared precedence walk behind resolveSessionSttConfig / resolveSessionLlmConfig:
 *   1. the simulation's pick for this language (a registry id)
 *   2. the language's own registry default
 *   3. the pre-registry jsonb column on the language
 *   4. the platform default.
 */
const resolveSessionProviderConfig = (
  picksByLanguage: Record<string, any> | null | undefined,
  languageId: number | string | null | undefined,
  registryById: Map<string, RegistryRow>,
  languageConfigId: string | null | undefined,
  legacyConfig: Record<string, any> | null | undefined,
  defaultConfig: ResolvedProviderConfig,
  toResolved: (
    row: RegistryRow | null | undefined,
  ) => ResolvedProviderConfig | null,
): ResolvedProviderConfig => {
  const pickedId =
    languageId != null && picksByLanguage
      ? picksByLanguage[String(languageId)]
      : undefined;

  if (typeof pickedId === 'string' && pickedId) {
    const resolved = toResolved(registryById.get(pickedId));
    if (resolved) return resolved;
  }

  if (languageConfigId) {
    const resolved = toResolved(registryById.get(languageConfigId));
    if (resolved) return resolved;
  }

  if (legacyConfig && Object.keys(legacyConfig).length > 0) {
    return legacyConfig as ResolvedProviderConfig;
  }

  return defaultConfig;
};

/**
 * Resolve the `stt` block sent to ally-ai-learn for one session.
 *
 * Precedence, for the session's language only:
 *   1. the simulation's own choice for this language
 *      (scenarios.metadata.sttConfigByLanguage[languageId] → a registry row)
 *   2. the language's default registry row (languages.sttConfigId)
 *   3. languages.sttProviderConfig — the pre-registry jsonb column, still read
 *      for rows the migration could not map
 *   4. the platform default.
 *
 * Keyed by language because STT quality is a language question before it is a
 * simulation one — Sarvam for one Indian language, Google chirp for the next,
 * Deepgram for English. A flat per-simulation override would force one engine
 * across every language the simulation runs in. These are the same keys as
 * `languageVoices`, and like it they store registry ids, not inline configs, so
 * changing a model is one edit rather than one per simulation.
 *
 * An empty object at level 3 counts as "not configured", matching how the
 * language row is seeded (`DEFAULT '{}'`).
 */
export const resolveSessionSttConfig = (
  sttConfigByLanguage: Record<string, any> | null | undefined,
  languageId: number | string | null | undefined,
  registryById: Map<string, RegistryRow>,
  language:
    | {
        sttConfigId?: string | null;
        sttProviderConfig?: Record<string, any> | null;
      }
    | null
    | undefined,
  defaultSttConfig: ResolvedProviderConfig,
): ResolvedProviderConfig =>
  resolveSessionProviderConfig(
    sttConfigByLanguage,
    languageId,
    registryById,
    language?.sttConfigId,
    language?.sttProviderConfig,
    defaultSttConfig,
    toResolvedSttConfig,
  );

/**
 * Resolve the `llm` block sent to ally-ai-learn for one session.
 *
 * Deliberately has no per-simulation layer, unlike STT. This value is only the
 * *base* config: the agent's `build_llm_client_for_prompt` lets a prompt (or a
 * selected language variant of it) override the model, and that override wins
 * over whatever is set here. A simulation-level LLM picker would therefore be
 * silently defeated whenever the main-agent prompt pins a model — which is the
 * team's established lever for exactly this kind of per-language tuning. So the
 * precedence stops at the language:
 *   languages.llmConfigId → languages.llmProviderConfig → the platform default.
 */
/**
 * Reduce an `llm_models` catalog row to the `{ provider, config }` shape the
 * runtime expects.
 *
 * A catalog row stores `model` as a column rather than inside a `config` blob,
 * so it needs lifting into the same shape an `llm_configs` row produces. The
 * catalog carries no temperature — that is a per-prompt / per-simulation
 * concern, and no LLM config ever set one, which is why this layer replaced it.
 */
export const toResolvedCatalogModel = (
  row: { provider?: string; model?: string } | null | undefined,
): ResolvedProviderConfig | null => {
  if (!row?.provider || !row?.model) return null;
  return { provider: row.provider, config: { model: row.model } };
};

/**
 * Resolve the LLM for a session.
 *
 * Precedence: the language's catalog model → its legacy `llm_configs` row →
 * the pre-registry jsonb column → the platform default. There is no
 * simulation-level layer, deliberately: a prompt's model override outranks this
 * (agent factory), so a per-simulation picker would be silently defeated.
 *
 * The `llm_configs` rung is retained only so a language whose catalog backfill
 * did not match keeps behaving as it did. Once every environment is mapped it
 * can go, together with the table.
 */
export const resolveSessionLlmConfig = (
  registryById: Map<string, RegistryRow>,
  language:
    | {
        llmModelId?: string | null;
        llmConfigId?: string | null;
        llmProviderConfig?: Record<string, any> | null;
      }
    | null
    | undefined,
  defaultLlmConfig: ResolvedProviderConfig,
  catalogById?: Map<string, { provider?: string; model?: string }>,
): ResolvedProviderConfig => {
  if (language?.llmModelId && catalogById) {
    const resolved = toResolvedCatalogModel(
      catalogById.get(language.llmModelId),
    );
    if (resolved) return resolved;
  }

  return resolveSessionProviderConfig(
    null,
    null,
    registryById,
    language?.llmConfigId,
    language?.llmProviderConfig,
    defaultLlmConfig,
    toResolvedLlmConfig,
  );
};

/**
 * Registry ids a session might need resolved for one service: the simulation's
 * pick for this language and the language's own default.
 */
export const collectProviderConfigIds = (
  picksByLanguage: Record<string, any> | null | undefined,
  languageId: number | string | null | undefined,
  languageConfigId: string | null | undefined,
): string[] => {
  const ids: string[] = [];
  const pickedId =
    languageId != null && picksByLanguage
      ? picksByLanguage[String(languageId)]
      : undefined;
  if (typeof pickedId === 'string' && pickedId) ids.push(pickedId);
  if (languageConfigId) ids.push(languageConfigId);
  return ids;
};

export const mapUpdateScenarioRequestToEntity = (
  updateScenarioDto: UpdateScenarioDto,
  existingScenario: Scenarios,
  userId: number,
) => {
  // Build update object
  const updateData: DeepPartial<Scenarios> = {
    updatedBy: userId,
  };

  const updateScenarioObjectFields = [
    'title',
    'description',
    'coverImageUrl',
    'coverVideoUrl',
    'status',
    'isPublic',
    'prompt',
    'isGlobal',
    'difficultyLevel',
    'competencyId',
    'category',
    'partnerOrgName',
  ];

  for (const field of updateScenarioObjectFields) {
    if (updateScenarioDto[field as keyof UpdateScenarioDto] !== undefined) {
      updateData[field as keyof Scenarios] = updateScenarioDto[
        field as keyof UpdateScenarioDto
      ] as any;
    }
  }

  // Handle metadata fields - merge with existing metadata
  const metadataUpdates: Record<string, any> = {};

  // Only include fields that are defined
  for (const field of SCENARIO_METADATA_FIELDS) {
    const value = updateScenarioDto[field as keyof UpdateScenarioDto];
    if (value !== undefined) {
      // Trim customFields to only include name and value properties
      if (field === 'customFields' && Array.isArray(value)) {
        metadataUpdates[field] = value.map((customField: any) => ({
          name: customField.name,
          value: customField.value,
          useInDefaultPrompt: customField.useInDefaultPrompt ?? true,
        }));
      } else {
        metadataUpdates[field] = value;
      }
    }
  }

  // If there are metadata updates, merge with existing metadata
  if (Object.keys(metadataUpdates).length > 0) {
    updateData.metadata = {
      ...existingScenario.metadata,
      ...metadataUpdates,
    };
  }
  return updateData;
};

export const isEnglishLanguage = (
  languageId?: number,
  languageValue?: string,
  defaultLanguageId?: number,
): boolean => {
  if (!languageId) {
    return true;
  }

  if (defaultLanguageId && languageId === defaultLanguageId) {
    return true;
  }

  if (
    languageValue?.toLowerCase() === 'en' ||
    languageValue?.toLowerCase().startsWith('en-')
  ) {
    return true;
  }

  return false;
};

export const applyScenarioTranslations = (
  scenario: Scenarios,
  languageCode?: string,
) => {
  if (!scenario || !languageCode) return scenario;
  if (scenario.translations && scenario.translations[languageCode]) {
    scenario.title =
      scenario.translations[languageCode].title || scenario.title;
    scenario.description =
      scenario.translations[languageCode].description || scenario.description;
  }
  delete scenario.translations;
  return scenario;
};
