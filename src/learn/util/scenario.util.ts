import { CreateScenarioDto } from '../dto/create-scenario.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { Scenarios } from '../entity/scenarios.entity';

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
    const triggerWarningIds = correspondingDto.triggerWarningIds || [];
    return triggerWarningIds.map((triggerWarningId) => ({
      scenarioId: savedScenario.id,
      triggerWarningId,
    }));
  });
