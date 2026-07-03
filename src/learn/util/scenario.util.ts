import { DeepPartial } from 'typeorm';
import { SCENARIO_MANDATORY_FIELDS } from '../constants/scenario-mandatory-fields.constants';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { Scenarios } from '../entity/scenarios.entity';
import { ExperienceMode, ChecklistType } from '../type/scenario.type';
import { toPromptCode } from 'src/prompt/util/prompt-code.util';
import { GeneratableField } from '../enum/generatable-field.enum';
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
  'temperature',
  'fillerEnabled',
  'comfortAudioEnabled',
  'historyTrimEnabled',
  'continuousBackchanneling',
  'interimReplyEnabled',
  'customFields',
  'languageVoices',
  'linguisticStyleSamples',
  'allowedFillerWords',
  'languageCharacteristics',
  'experienceMode',
  'checklistType',
  'timerMode',
  'maxTimeValue',
  'optGuardrails',
  'characterProfileText',
  'helperAgentPrompt',
  'agentBuilderDescription',
  'agentBuilderPrompt',
  'showScoreMeter',
  'enableFeedback',
  'pauseEnabled',
  'currentState',
  'knowledgeSources',
  'stateNames',
  'selectedMainPromptCode',
  'selectedEvaluatorPromptCode',
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
    metadata: {
      name: scenario.name,
      age: scenario.age,
      gender: scenario.gender,
      genderIdentity: scenario.genderIdentity,
      sexualOrientation: scenario.sexualOrientation,
      currentLocation: scenario.currentLocation,
      profession: scenario.profession,
      openingStatements: scenario.openingStatements,
      temperature: scenario.temperature,
      fillerEnabled: scenario.fillerEnabled,
      comfortAudioEnabled: scenario.comfortAudioEnabled,
      historyTrimEnabled: scenario.historyTrimEnabled,
      continuousBackchanneling: scenario.continuousBackchanneling,
      interimReplyEnabled: scenario.interimReplyEnabled,
      customFields: scenario.customFields?.map((customField) => ({
        name: customField.name,
        value: customField.value,
        useInDefaultPrompt: customField.useInDefaultPrompt ?? true,
      })),
      languageVoices: scenario.languageVoices,
      linguisticStyleSamples: scenario.linguisticStyleSamples,
      allowedFillerWords: scenario.allowedFillerWords,
      languageCharacteristics: scenario.languageCharacteristics,
      experienceMode: scenario.experienceMode,
      ...(scenario.experienceMode === ExperienceMode.CHECKLIST && {
        checklistType: scenario.checklistType || ChecklistType.GUIDED,
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
      pauseEnabled: scenario.pauseEnabled,
      currentState: scenario.currentState,
      knowledgeSources: scenario.knowledgeSources?.map((knowledgeSource) => ({
        id: knowledgeSource.id,
        title: knowledgeSource.title,
        content: knowledgeSource.content,
      })),
      stateNames: scenario.stateNames,
      selectedMainPromptCode: scenario.selectedMainPromptCode,
      selectedEvaluatorPromptCode: scenario.selectedEvaluatorPromptCode,
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

export const getPromptCodeForScenarioField = (scenarioField: string) => {
  switch (scenarioField) {
    case GeneratableField.STATE_INSTRUCTIONS:
      return toPromptCode('openai_simulation', 'states_instructions');
    case GeneratableField.OPENING_STATEMENTS:
      return toPromptCode('openai_simulation', 'opening_dialogues');
    case GeneratableField.DESCRIPTION:
      return toPromptCode('openai_simulation', 'challenge_description');
    case GeneratableField.CHARACTER_PROFILE_TEXT:
      return toPromptCode('openai_simulation', 'character_profile_text');
    case GeneratableField.BEHAVIOR_INSTRUCTIONS:
      return toPromptCode('openai_simulation', 'behavior_instructions');
    case GeneratableField.LINGUISTIC_STYLE_SAMPLES:
      return toPromptCode('openai_simulation', 'linguistic_style_samples');
    case GeneratableField.ALLOWED_FILLER_WORDS:
      return toPromptCode('openai_simulation', 'allowed_filler_words');
    case GeneratableField.STATES:
      return toPromptCode('openai_simulation', 'states');
    case GeneratableField.KNOWLEDGE_SOURCES:
      return toPromptCode('openai_simulation', 'knowledge_sources');
  }
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
