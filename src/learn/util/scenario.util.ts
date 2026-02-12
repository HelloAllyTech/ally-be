import { DeepPartial } from 'typeorm';
import {
  SCENARIO_MANDATORY_FIELDS,
  SCENARIO_MANDATORY_FIELDS_WITHOUT_STATE_BASED_CHANGES,
} from '../constants/scenario-mandatory-fields.constants';
import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { Scenarios } from '../entity/scenarios.entity';
import { ExperienceMode, ChecklistType } from '../type/scenario.type';
import { StateInstructionsDto } from '../dto/state-instructions.dto';
import { ScenarioStateInstruction } from '../type/scenario-state.type';

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
      // FEATURE_CLEANUP(FEATURE_SCENARIO_STATE_INSTRUCTIONS): remove the input from context and dialogues and keep it only stateInstructions
      stateInstructions: getFormattedScenarioInstructions(
        scenario.stateInstructions,
        { context: scenario.context, agentDialogues: scenario.agentDialogues },
      ),
    },
  };
};

const getFormattedScenarioInstructions = (
  scenarioInstructions: StateInstructionsDto[] | undefined,
  { context, agentDialogues }: { context?: string; agentDialogues?: string[] },
): ScenarioStateInstruction[] | undefined => {
  if (scenarioInstructions) return scenarioInstructions;
  if (context || agentDialogues)
    return [
      {
        stateId: '2',
        instruction: context || '',
        dialogues: agentDialogues || [],
      },
    ];
  return undefined;
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

// FEATURE_CLEANUP(FEATURE_SCENARIO_STATE_INSTRUCTIONS): remove the input feature flag and util accordingly
export const getActiveScenarioMandatoryFields = (stateBasedFeature: boolean) =>
  stateBasedFeature
    ? SCENARIO_MANDATORY_FIELDS
    : SCENARIO_MANDATORY_FIELDS_WITHOUT_STATE_BASED_CHANGES;

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
    'stateInstructions',
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
  // FEATURE_CLEANUP(FEATURE_SCENARIO_STATE_INSTRUCTIONS): remove the input from context and dialogues and keep it only stateInstructions
  metadataUpdates.stateInstructions = getFormattedScenarioInstructions(
    updateScenarioDto.stateInstructions,
    {
      context: updateScenarioDto.context,
      agentDialogues: updateScenarioDto.agentDialogues,
    },
  );

  // If there are metadata updates, merge with existing metadata
  if (Object.keys(metadataUpdates).length > 0) {
    updateData.metadata = {
      ...existingScenario.metadata,
      ...metadataUpdates,
    };
  }
  return updateData;
};
