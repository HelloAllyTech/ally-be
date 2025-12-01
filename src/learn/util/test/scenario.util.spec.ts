import {
  mapCreateScenarioRequestToEntity,
  formatAutoTerminationEventsList,
} from '../scenario.util';
import { CreateScenarioDto } from '../../dto/create-scenario.dto';
import { CreateScenariosDto } from '../../dto/create-scenarios.dto';
import { Scenarios } from '../../entity/scenarios.entity';
import { ScenarioStatus } from '../../enum/scenario.status.enum';
import {
  Gender,
  GenderIdentity,
  SexualOrientation,
} from 'src/learn/enum/gender.enum';

describe('Scenario Util', () => {
  describe('mapCreateScenarioRequestToEntity', () => {
    it('should map create scenario DTO to entity with all fields', () => {
      const userId = 123;
      const scenario: CreateScenarioDto = {
        title: 'Test Scenario',
        description: 'Test Description',
        coverImageUrl: 'https://example.com/image.jpg',
        coverVideoUrl: 'https://example.com/video.mp4',
        status: ScenarioStatus.DRAFT,
        prompt: 'You are a counselor',
        isGlobal: true,
        agentGoal: 'Help the client',
        lifeHistory: 'Life history',
        voiceId: 'voice-123',
        name: 'John Doe',
        age: 30,
        gender: Gender.MALE,
        genderIdentity: GenderIdentity.MALE_MAN,
        sexualOrientation: SexualOrientation.HETEROSEXUAL,
        currentLocation: 'New York',
        profession: 'Engineer',
        context: 'Context',
        sessionBehaviorGuidelines: 'Guidelines',
        coreMemories: 'Core memories',
        personality: 'Friendly',
        startingState: 'Calm',
        emotionalNeeds: 'Support',
        tone: 'Warm',
        openingStatements: ['Hello', 'Welcome'],
      };

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result).toEqual({
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
      });
    });

    it('should map create scenario DTO with minimal fields', () => {
      const userId = 456;
      const scenario: CreateScenarioDto = {
        title: 'Minimal Scenario',
        description: 'Minimal Description',
        status: ScenarioStatus.ACTIVE,
        prompt: 'Minimal Prompt',
        isGlobal: false,
        agentGoal: 'Goal',
        lifeHistory: 'History',
        voiceId: 'voice-456',
        name: 'Jane',
        age: 25,
        gender: Gender.FEMALE,
        currentLocation: 'LA',
        context: 'Context',
        openingStatements: ['Hi'],
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.createdBy).toBe(userId);
      expect(result.updatedBy).toBe(userId);
      expect(result.title).toBe(scenario.title);
      expect(result.scenario).toBe('');
      expect(result.metadata.name).toBe(scenario.name);
    });
  });

  describe('formatAutoTerminationEventsList', () => {
    it('should format auto termination events list with all events enabled', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEventId: 'event-1',
            autoTerminationStatus: true,
            terminationMessage: 'Session ended',
          } as any,
          {
            terminationEventId: 'event-2',
            autoTerminationStatus: true,
            terminationMessage: 'Time is up',
          } as any,
        ],
      };

      const savedScenarios: Scenarios[] = [
        { id: 1, title: 'Scenario 1' } as Scenarios,
        { id: 2, title: 'Scenario 2' } as Scenarios,
      ];

      const result = formatAutoTerminationEventsList(
        createScenariosDto,
        savedScenarios,
      );

      expect(result).toEqual([
        {
          scenarioId: 1,
          eventId: 'event-1',
          autoTerminationStatus: true,
          message: 'Session ended',
        },
        {
          scenarioId: 2,
          eventId: 'event-2',
          autoTerminationStatus: true,
          message: 'Time is up',
        },
      ]);
    });

    it('should filter out events with autoTerminationStatus false', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEventId: 'event-1',
            autoTerminationStatus: true,
            terminationMessage: 'Session ended',
          } as any,
          {
            terminationEventId: 'event-2',
            autoTerminationStatus: false,
            terminationMessage: 'Not used',
          } as any,
        ],
      };

      const savedScenarios: Scenarios[] = [
        { id: 1, title: 'Scenario 1' } as Scenarios,
        { id: 2, title: 'Scenario 2' } as Scenarios,
      ];

      const result = formatAutoTerminationEventsList(
        createScenariosDto,
        savedScenarios,
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        scenarioId: 1,
        eventId: 'event-1',
        autoTerminationStatus: true,
        message: 'Session ended',
      });
    });

    it('should filter out events without eventId', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEventId: undefined,
            autoTerminationStatus: true,
            terminationMessage: 'Session ended',
          } as any,
          {
            terminationEventId: 'event-2',
            autoTerminationStatus: true,
            terminationMessage: 'Time is up',
          } as any,
        ],
      };

      const savedScenarios: Scenarios[] = [
        { id: 1, title: 'Scenario 1' } as Scenarios,
        { id: 2, title: 'Scenario 2' } as Scenarios,
      ];

      const result = formatAutoTerminationEventsList(
        createScenariosDto,
        savedScenarios,
      );

      expect(result).toHaveLength(1);
      expect(result[0].scenarioId).toBe(2);
    });

    it('should return empty array when no events match criteria', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEventId: undefined,
            autoTerminationStatus: false,
            terminationMessage: 'Not used',
          } as any,
        ],
      };

      const savedScenarios: Scenarios[] = [
        { id: 1, title: 'Scenario 1' } as Scenarios,
      ];

      const result = formatAutoTerminationEventsList(
        createScenariosDto,
        savedScenarios,
      );

      expect(result).toEqual([]);
    });
  });
});
