import {
  mapCreateScenarioRequestToEntity,
  formatAutoTerminationEventsList,
  formatScenarioTriggerWarningsList,
} from '../scenario.util';
import { CreateScenarioDto } from '../../dto/create-scenario.dto';
import { CreateScenariosDto } from '../../dto/create-scenarios.dto';
import { Scenarios } from '../../entity/scenarios.entity';
import {
  ScenarioStatus,
  ExperienceMode,
  ChecklistType,
} from '../../type/scenario.type';
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
        name: 'John Doe',
        age: 30,
        gender: Gender.MALE,
        genderIdentity: GenderIdentity.MALE_MAN,
        sexualOrientation: SexualOrientation.HETEROSEXUAL,
        currentLocation: 'New York',
        profession: 'Engineer',
        personality: 'Friendly',
        tone: 'Warm',
        openingStatements: ['Hello', 'Welcome'],
        experienceMode: ExperienceMode.CHECKLIST,
        checklistType: ChecklistType.GUIDED,
        timerMode: true,
        maxTimeValue: '1:30:00',
        optGuardrails: true,
        currentState: true,
      };

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result).toEqual({
        createdBy: userId,
        updatedBy: userId,
        title: scenario.title,
        scenario: '',
        isPublic: scenario.isPublic,
        description: scenario.description,
        coverImageUrl: scenario.coverImageUrl,
        coverVideoUrl: scenario.coverVideoUrl,
        status: scenario.status,
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
          tone: scenario.tone,
          openingStatements: scenario.openingStatements,
          responseLength: scenario.responseLength,
          customFields: scenario.customFields,
          languageVoices: scenario.languageVoices,
          linguisticStyleSamples: scenario.linguisticStyleSamples,
          characterProfileText: scenario.characterProfileText,
          showScoreMeter: scenario.showScoreMeter,
          experienceMode: ExperienceMode.CHECKLIST,
          checklistType: ChecklistType.GUIDED,
          timerMode: true,
          maxTimeValue: '1:30:00',
          optGuardrails: scenario.optGuardrails,
          stateInstructions: scenario.stateInstructions,
          knowledgeSources: scenario.knowledgeSources,
          currentState: scenario.currentState,
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
        name: 'Jane',
        age: 25,
        gender: Gender.FEMALE,
        currentLocation: 'LA',
        openingStatements: ['Hi'],
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.createdBy).toBe(userId);
      expect(result.updatedBy).toBe(userId);
      expect(result.title).toBe(scenario.title);
      expect(result.scenario).toBe('');
      expect(result.metadata.name).toBe(scenario.name);
    });

    it('should map custom fields with only name and value properties', () => {
      const userId = 789;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with Custom Fields',
        status: ScenarioStatus.DRAFT,
        customFields: [
          { name: 'Field 1', value: 'Value 1', useInDefaultPrompt: true },
          { name: 'Field 2', value: 'Value 2', useInDefaultPrompt: true },
        ],
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.customFields).toEqual([
        { name: 'Field 1', value: 'Value 1', useInDefaultPrompt: true },
        { name: 'Field 2', value: 'Value 2', useInDefaultPrompt: true },
      ]);
    });

    it('should trim extra properties from custom fields and keep only name and value', () => {
      const userId = 101;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with Extra Custom Field Properties',
        status: ScenarioStatus.DRAFT,
        customFields: [
          {
            name: 'Field 1',
            value: 'Value 1',
            extraProp: 'should be trimmed',
            anotherExtra: 123,
            useInDefaultPrompt: true,
          } as any,
          {
            name: 'Field 2',
            value: 'Value 2',
            id: 'some-id',
            useInDefaultPrompt: true,
            metadata: { nested: 'data' },
          } as any,
        ],
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.customFields).toEqual([
        { name: 'Field 1', value: 'Value 1', useInDefaultPrompt: true },
        { name: 'Field 2', value: 'Value 2', useInDefaultPrompt: true },
      ]);
      expect(result.metadata.customFields).toHaveLength(2);
      expect(result.metadata.customFields![0]).not.toHaveProperty('extraProp');
      expect(result.metadata.customFields![0]).not.toHaveProperty(
        'anotherExtra',
      );
      expect(result.metadata.customFields![1]).not.toHaveProperty('id');
      expect(result.metadata.customFields![1]).not.toHaveProperty('metadata');
    });

    it('should handle undefined custom fields', () => {
      const userId = 102;
      const scenario: CreateScenarioDto = {
        title: 'Scenario without Custom Fields',
        status: ScenarioStatus.DRAFT,
        customFields: undefined,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.customFields).toBeUndefined();
    });

    it('should handle empty custom fields array', () => {
      const userId = 103;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with Empty Custom Fields',
        status: ScenarioStatus.DRAFT,
        customFields: [],
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.customFields).toEqual([]);
    });

    it('should include checklistType only when experienceMode is CHECKLIST', () => {
      const userId = 201;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with CHECKLIST experience mode',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        experienceMode: ExperienceMode.CHECKLIST,
        checklistType: ChecklistType.GUIDED,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.experienceMode).toBe(ExperienceMode.CHECKLIST);
      expect(result.metadata.checklistType).toBe(ChecklistType.GUIDED);
    });

    it('should not include checklistType when experienceMode is FEEDBACK', () => {
      const userId = 203;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with FEEDBACK experience mode',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        experienceMode: ExperienceMode.FEEDBACK,
        checklistType: ChecklistType.GUIDED,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.experienceMode).toBe(ExperienceMode.FEEDBACK);
      expect(result.metadata.checklistType).toBeUndefined();
    });

    it('should handle explicit FEEDBACK mode with all fields', () => {
      const userId = 204;
      const scenario: CreateScenarioDto = {
        title: 'Complete Scenario with FEEDBACK mode',
        description: 'Description',
        status: ScenarioStatus.ACTIVE,
        prompt: 'You are a counselor',
        isGlobal: true,
        difficultyLevel: 'INTERMEDIATE',
        name: 'Test User',
        age: 30,
        experienceMode: ExperienceMode.FEEDBACK,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata).toEqual(
        expect.objectContaining({
          experienceMode: ExperienceMode.FEEDBACK,
          name: 'Test User',
          age: 30,
        }),
      );
      expect(result.metadata.checklistType).toBeUndefined();
    });

    it('should handle explicit CHECKLIST mode with UNGUIDED type', () => {
      const userId = 205;
      const scenario: CreateScenarioDto = {
        title: 'CHECKLIST Scenario with UNGUIDED type',
        description: 'Description',
        status: ScenarioStatus.ACTIVE,
        prompt: 'Prompt',
        isGlobal: false,
        name: 'Test Client',
        age: 25,
        experienceMode: ExperienceMode.CHECKLIST,
        checklistType: ChecklistType.UNGUIDED,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.experienceMode).toBe(ExperienceMode.CHECKLIST);
      expect(result.metadata.checklistType).toBe(ChecklistType.UNGUIDED);
    });

    it('should include maxTimeValue only when timerMode is true', () => {
      const userId = 301;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with Timer',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        timerMode: true,
        maxTimeValue: '1:20:00',
      } as any;
      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.timerMode).toBe(true);
      expect(result.metadata.maxTimeValue).toBe('1:20:00');
    });

    it('should not include maxTimeValue when timerMode is false', () => {
      const userId = 302;
      const scenario: CreateScenarioDto = {
        title: 'Scenario without Timer',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        timerMode: false,
        maxTimeValue: '1:20:00',
      } as any;
      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.timerMode).toBe(false);
      expect(result.metadata.maxTimeValue).toBeUndefined();
    });

    it('should handle undefined timerMode and maxTimeValue', () => {
      const userId = 303;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with Undefined Timer',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        timerMode: undefined,
        maxTimeValue: undefined,
      } as any;
      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.timerMode).toBeUndefined();
      expect(result.metadata.maxTimeValue).toBeUndefined();
    });
  });

  describe('formatAutoTerminationEventsList', () => {
    it('should format auto termination events list with all events enabled', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEvents: [{ id: 'event-1', message: 'Session ended' }],
          } as any,
          {
            terminationEvents: [{ id: 'event-2', message: 'Time is up' }],
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

    it('should filter out scenarios without terminationEvents', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEvents: [{ id: 'event-1', message: 'Session ended' }],
          } as any,
          {
            terminationEvents: undefined,
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

    it('should filter out scenarios with empty terminationEvents array', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            terminationEvents: [],
          } as any,
          {
            terminationEvents: [{ id: 'event-2', message: 'Time is up' }],
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

  describe('formatScenarioTriggerWarningsList', () => {
    it('should return empty array when scenarios have no trigger warnings', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            title: 'Scenario 1',
            triggerWarningIds: [],
          } as any,
          {
            title: 'Scenario 2',
            triggerWarningIds: undefined,
          } as any,
          {
            title: 'Scenario 3',
          } as any,
        ],
      };

      const savedScenarios: Scenarios[] = [
        { id: 1, title: 'Scenario 1' } as Scenarios,
        { id: 2, title: 'Scenario 2' } as Scenarios,
        { id: 3, title: 'Scenario 3' } as Scenarios,
      ];

      const result = formatScenarioTriggerWarningsList(
        createScenariosDto,
        savedScenarios,
      );

      expect(result).toEqual([]);
    });

    it('should flatten multiple trigger warnings from different scenarios into a single list', () => {
      const createScenariosDto: CreateScenariosDto = {
        scenarios: [
          {
            title: 'Scenario 1',
            triggerWarningIds: ['uuid-1', 'uuid-2'],
          } as any,
          {
            title: 'Scenario 2',
            triggerWarningIds: ['uuid-3', 'uuid-4', 'uuid-5'],
          } as any,
        ],
      };

      const savedScenarios: Scenarios[] = [
        { id: 1, title: 'Scenario 1' } as Scenarios,
        { id: 2, title: 'Scenario 2' } as Scenarios,
      ];

      const result = formatScenarioTriggerWarningsList(
        createScenariosDto,
        savedScenarios,
      );

      expect(result).toEqual([
        { scenarioId: 1, triggerWarningId: 'uuid-1' },
        { scenarioId: 1, triggerWarningId: 'uuid-2' },
        { scenarioId: 2, triggerWarningId: 'uuid-3' },
        { scenarioId: 2, triggerWarningId: 'uuid-4' },
        { scenarioId: 2, triggerWarningId: 'uuid-5' },
      ]);
    });
  });
});
