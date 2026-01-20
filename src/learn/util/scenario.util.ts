import { DeepPartial } from 'typeorm';
import { SCENARIO_MANDATORY_FIELDS } from '../constants/scenario-mandatory-fields.constants';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { Scenarios } from '../entity/scenarios.entity';
import { ExperienceMode, ChecklistType } from '../type/scenario.type';

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
      agentDialogues: scenario.agentDialogues,
      responseLength: scenario.responseLength,
      customFields: scenario.customFields?.map((customField) => ({
        name: customField.name,
        value: customField.value,
      })),
      languageVoices: scenario.languageVoices,
      experienceMode: scenario.experienceMode,
      ...(scenario.experienceMode === ExperienceMode.CHECKLIST && {
        checklistType: scenario.checklistType || ChecklistType.GUIDED,
      }),
      timerMode: scenario.timerMode,
      ...(scenario.timerMode === true && {
        maxTimeValue: scenario.maxTimeValue,
      }),
    },
  };
};

export const formatSingleAutoTerminationEventsList = (
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
  ];

  for (const field of updateScenarioObjectFields) {
    if (updateScenarioDto[field as keyof UpdateScenarioDto] !== undefined) {
      updateData[field as keyof Scenarios] = updateScenarioDto[
        field as keyof UpdateScenarioDto
      ] as any;
    }
  }

  const metadataFields: (keyof UpdateScenarioDto)[] = [
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
    'agentDialogues',
    'responseLength',
    'voiceId',
    'customFields',
    'languageVoices',
    'experienceMode',
    'checklistType',
    'timerMode',
    'maxTimeValue',
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
