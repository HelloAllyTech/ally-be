import { DeepPartial } from 'typeorm';
import {
  SCENARIO_MANDATORY_FIELDS,
  SCENARIO_MANDATORY_FIELDS_WITHOUT_CUSTOM_FIELDS,
} from '../constants/scenario-mandatory-fields.constants';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { Scenarios } from '../entity/scenarios.entity';

// FEATURE_CLEANUP(FEATURE_SCENARIO_CUSTOM_FIELDS): Remove  util and its usage
export const mapCreateScenarioRequestToEntityWithoutCustomFields = (
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
    isGlobal: scenario.isGlobal,
    metadata: {
      agentGoal: scenario.agentGoal,
      lifeHistory: scenario.lifeHistory,
      voiceId: scenario.voiceId,
      name: scenario.name,
      age: scenario.age,
      gender: scenario.gender,
      genderIdentity: scenario.genderIdentity,
      sexualOrientation: scenario.sexualOrientation,
      currentLocation: scenario.currentLocation,
      profession: scenario.profession,
      context: scenario.context,
      sessionBehaviorGuidelines: scenario.sessionBehaviorGuidelines,
      coreMemories: scenario.coreMemories,
      personality: scenario.personality,
      startingState: scenario.startingState,
      emotionalNeeds: scenario.emotionalNeeds,
      tone: scenario.tone,
      openingStatements: scenario.openingStatements,
    },
  };
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
    prompt: scenario.prompt,
    isGlobal: scenario.isGlobal,
    difficultyLevel: scenario.difficultyLevel,
    metadata: {
      voiceId: scenario.voiceId,
      name: scenario.name,
      age: scenario.age,
      gender: scenario.gender,
      genderIdentity: scenario.genderIdentity,
      sexualOrientation: scenario.sexualOrientation,
      currentLocation: scenario.currentLocation,
      profession: scenario.profession,
      context: scenario.context,
      tone: scenario.tone,
      openingStatements: scenario.openingStatements,
      sampleDialogues: scenario.sampleDialogues,
      responseLength: scenario.responseLength,
      customFields: scenario.customFields?.map((customField) => ({
        name: customField.name,
        value: customField.value,
      })),
    },
  };
};

export const formatAutoTerminationEventsList = (
  createScenariosDto: CreateScenariosDto,
  savedScenarios: Scenarios[],
) =>
  savedScenarios
    .map((savedScenario, index) => {
      const correspondingDto = createScenariosDto.scenarios[index];
      return {
        scenarioId: savedScenario.id,
        eventId: correspondingDto.terminationEventId,
        autoTerminationStatus: correspondingDto.autoTerminationStatus,
        message: correspondingDto.terminationMessage,
      };
    })
    .filter((event) => event.eventId && event.autoTerminationStatus);

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

// FEATURE_CLEANUP(FEATURE_SCENARIO_CUSTOM_FIELDS): Remove util and its usage
export const getActiveScenarioMandatoryFields = (customFields: boolean) => {
  return customFields
    ? SCENARIO_MANDATORY_FIELDS
    : SCENARIO_MANDATORY_FIELDS_WITHOUT_CUSTOM_FIELDS;
};

export const mapUpdateScenarioRequestToEntity = (
  updateScenarioDto: UpdateScenarioDto,
  existingScenario: Scenarios,
  userId: number,
  scenarioCustomFieldFeatureFlag: boolean,
) => {
  // Build update object
  const updateData: DeepPartial<Scenarios> = {
    updatedBy: userId,
  };

  const updateScenarioObjectFields = scenarioCustomFieldFeatureFlag
    ? [
        'title',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
        'prompt',
        'isGlobal',
        'difficultyLevel',
      ]
    : [
        'title',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
        'prompt',
        'isGlobal',
      ];

  for (const field of updateScenarioObjectFields) {
    if (updateScenarioDto[field as keyof UpdateScenarioDto] !== undefined) {
      updateData[field as keyof Scenarios] = updateScenarioDto[
        field as keyof UpdateScenarioDto
      ] as any;
    }
  }

  const metadataFields: (keyof UpdateScenarioDto)[] =
    scenarioCustomFieldFeatureFlag
      ? [
          'name',
          'age',
          'gender',
          'genderIdentity',
          'sexualOrientation',
          'currentLocation',
          'profession',
          'context',
          'tone',
          'openingStatements',
          'sampleDialogues',
          'responseLength',
          'voiceId',
          'customFields',
        ]
      : [
          'agentGoal',
          'name',
          'age',
          'gender',
          'genderIdentity',
          'sexualOrientation',
          'currentLocation',
          'profession',
          'context',
          'sessionBehaviorGuidelines',
          'lifeHistory',
          'coreMemories',
          'personality',
          'startingState',
          'emotionalNeeds',
          'tone',
          'openingStatements',
          'voiceId',
        ];

  // Handle metadata fields - merge with existing metadata
  const metadataUpdates: Record<string, any> = {};

  // Only include fields that are defined
  for (const field of metadataFields) {
    const value = updateScenarioDto[field as keyof UpdateScenarioDto];
    if (value !== undefined) {
      // Trim customFields to only include name and value properties
      if (field === 'customFields' && Array.isArray(value)) {
        metadataUpdates[field] = value.map((customField: any) => ({
          name: customField.name,
          value: customField.value,
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
