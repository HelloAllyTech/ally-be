import {
  mapCreateScenarioRequestToEntity,
  mapUpdateScenarioRequestToEntity,
  formatAutoTerminationEventsList,
  formatScenarioTriggerWarningsList,
  hydrateAdminScenarioFromVersionConfig,
  collectProviderConfigIds,
  resolveSessionSttConfig,
  resolveSessionLlmConfig,
} from '../scenario.util';
import { GetAdminScenarioDto } from '../../dto/get-scenario.dto';
import { CreateScenarioDto } from '../../dto/create-scenario.dto';
import { CreateScenariosDto } from '../../dto/create-scenarios.dto';
import { UpdateScenarioDto } from '../../dto/update-scenario.dto';
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
        openingStatements: ['Hello', 'Welcome'],
        reminders: ['Maintain eye contact', 'Ask open-ended questions'],
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
          openingStatements: scenario.openingStatements,
          reminders: scenario.reminders,
          customFields: scenario.customFields,
          languageVoices: scenario.languageVoices,
          linguisticStyleSamples: scenario.linguisticStyleSamples,
          allowedFillerWords: scenario.allowedFillerWords,
          characterProfileText: scenario.characterProfileText,
          showScoreMeter: scenario.showScoreMeter,
          experienceMode: ExperienceMode.CHECKLIST,
          checklistType: ChecklistType.GUIDED,
          timerMode: true,
          maxTimeValue: '1:30:00',
          optGuardrails: scenario.optGuardrails,
          knowledgeSources: scenario.knowledgeSources,
          currentState: scenario.currentState,
        },
      });
    });

    it('should map turnMaxEndpointingDelay into metadata when set', () => {
      const userId = 111;
      const scenario: CreateScenarioDto = {
        title: 'Endpointing Override Scenario',
        description: 'Test Description',
        status: ScenarioStatus.DRAFT,
        turnMaxEndpointingDelay: 1.5,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.turnMaxEndpointingDelay).toBe(1.5);
    });

    it('should leave turnMaxEndpointingDelay undefined when unset', () => {
      const userId = 112;
      const scenario: CreateScenarioDto = {
        title: 'No Override Scenario',
        description: 'Test Description',
        status: ScenarioStatus.DRAFT,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.turnMaxEndpointingDelay).toBeUndefined();
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

    it('should not include checklistType when experienceMode is NONE', () => {
      const userId = 205;
      const scenario: CreateScenarioDto = {
        title: 'Scenario with NONE experience mode',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        experienceMode: ExperienceMode.NONE,
        checklistType: ChecklistType.GUIDED,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.experienceMode).toBe(ExperienceMode.NONE);
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

    it('should persist temperature to metadata when provided (forwarded to ally-ai-learn as promptData.temperature)', () => {
      const userId = 403;
      const scenario: CreateScenarioDto = {
        title: 'Temperature Scenario',
        description: 'Description',
        status: ScenarioStatus.DRAFT,
        prompt: 'Prompt',
        isGlobal: false,
        temperature: 0.3,
      } as any;

      const result = mapCreateScenarioRequestToEntity(scenario, userId);

      expect(result.metadata.temperature).toBe(0.3);
    });
  });

  describe('mapUpdateScenarioRequestToEntity', () => {
    it('should merge temperature into existing metadata without losing other keys', () => {
      const userId = 503;
      const existingScenario = {
        id: 1,
        metadata: { name: 'Existing', temperature: 0.7 },
      } as unknown as Scenarios;
      const dto: UpdateScenarioDto = { temperature: 1.2 } as any;

      const result = mapUpdateScenarioRequestToEntity(
        dto,
        existingScenario,
        userId,
      );

      expect(result.metadata).toEqual({
        name: 'Existing',
        temperature: 1.2,
      });
    });

    it('should leave existing metadata.temperature untouched when omitted from DTO', () => {
      const userId = 504;
      const existingScenario = {
        id: 1,
        metadata: { name: 'Existing', temperature: 0.4 },
      } as unknown as Scenarios;
      const dto: UpdateScenarioDto = { name: 'Updated' } as any;

      const result = mapUpdateScenarioRequestToEntity(
        dto,
        existingScenario,
        userId,
      );

      expect(result.metadata).toEqual({
        name: 'Updated',
        temperature: 0.4,
      });
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

  describe('hydrateAdminScenarioFromVersionConfig', () => {
    // The live scenario the draft is overlaid on. Carries identity + fields
    // that must survive when the draft doesn't override them.
    const base = {
      id: 42,
      title: 'LIVE title',
      description: 'live description',
      prompt: 'LIVE prompt',
      coverImageUrl: 'https://live/cover.png',
      isPublic: true,
      isGlobal: false,
      difficultyLevel: 'MEDIUM',
      competencyId: 'comp-1',
      publishedVersionId: 'v-live',
      metadata: {
        name: 'LiveName',
        age: 30,
        gender: 'MALE',
        // base-only metadata that the draft doesn't touch — must be preserved.
        languageVoices: { '1': 'voice-1' },
      },
      terminationEvents: [{ eventId: 99 }],
      behaviorInstructions: [{ category: 'SHOULD_DO' }],
      triggerWarnings: [{ id: 'tw-live' }],
    } as unknown as GetAdminScenarioDto;

    it('overlays the draft config onto the live scenario (form shape)', () => {
      const config = {
        title: 'DRAFT title',
        prompt: 'DRAFT prompt',
        // metadata fields flattened at top level (DTO shape)
        name: 'DraftName',
        age: 16,
        openingStatements: 'Hi, I am the draft.',
        status: ScenarioStatus.DRAFT,
        terminationEvents: [{ eventId: 7 }],
        behaviorInstructions: [{ category: 'SHOULD_NOT_DO' }],
      };

      const result = hydrateAdminScenarioFromVersionConfig(base, config);

      // Root fields overridden by the draft.
      expect(result.title).toBe('DRAFT title');
      expect(result.prompt).toBe('DRAFT prompt');
      // Identity preserved from base.
      expect(result.id).toBe(42);
      expect(result.competencyId).toBe('comp-1');
      // Flattened persona fields rebuilt into nested metadata.
      expect(result.metadata?.name).toBe('DraftName');
      expect(result.metadata?.age).toBe(16);
      expect(result.metadata?.openingStatements).toBe('Hi, I am the draft.');
      // Base-only metadata not present in the draft survives.
      expect(result.metadata?.languageVoices).toEqual({ '1': 'voice-1' });
      // Related arrays come from the draft.
      expect(result.terminationEvents).toEqual([{ eventId: 7 }]);
      expect(result.behaviorInstructions).toEqual([
        { category: 'SHOULD_NOT_DO' },
      ]);
    });

    it('keeps base values for fields the draft omits', () => {
      const result = hydrateAdminScenarioFromVersionConfig(base, {
        title: 'only title changed',
      });

      expect(result.title).toBe('only title changed');
      expect(result.prompt).toBe('LIVE prompt');
      expect(result.metadata?.name).toBe('LiveName');
      expect(result.terminationEvents).toEqual([{ eventId: 99 }]);
    });

    it('does not mutate the base scenario or its metadata', () => {
      const result = hydrateAdminScenarioFromVersionConfig(base, {
        name: 'DraftName',
      });

      expect(result.metadata).not.toBe(base.metadata);
      expect(base.metadata?.name).toBe('LiveName');
      expect(base.title).toBe('LIVE title');
    });
  });

  describe('resolveSessionSttConfig', () => {
    const DEEPGRAM_ID = '11111111-1111-4111-8111-111111111111';
    const GOOGLE_ID = '22222222-2222-4222-8222-222222222222';
    const ELEVENLABS_ID = '33333333-3333-4333-8333-333333333333';

    const deepgram = { provider: 'deepgram', config: { model: 'nova-3' } };
    const google = {
      provider: 'google',
      config: { model: 'chirp_2', location: 'asia-southeast1' },
    };
    const elevenLabs = {
      provider: 'elevenlabs',
      config: { model: 'scribe_v2_realtime' },
    };

    const registry = new Map<string, any>([
      [DEEPGRAM_ID, deepgram],
      [GOOGLE_ID, google],
      [ELEVENLABS_ID, elevenLabs],
    ]);

    // A language whose default came through the registry migration.
    const language = { sttConfigId: GOOGLE_ID, sttProviderConfig: {} };
    const platformDefault = deepgram;

    it("prefers this language's simulation pick over the language default", () => {
      expect(
        resolveSessionSttConfig(
          { '9': ELEVENLABS_ID },
          9,
          registry,
          language,
          platformDefault,
        ),
      ).toEqual(elevenLabs);
    });

    it('accepts a numeric or string language id', () => {
      expect(
        resolveSessionSttConfig(
          { '9': ELEVENLABS_ID },
          '9',
          registry,
          language,
          platformDefault,
        ),
      ).toEqual(elevenLabs);
    });

    it('only applies the pick to the language it was set for', () => {
      // The whole point of keying by language: overriding Kannada must not
      // drag English onto the same engine.
      const picks = { '9': ELEVENLABS_ID };

      expect(
        resolveSessionSttConfig(picks, 1, registry, language, platformDefault),
      ).toEqual(google);
      expect(
        resolveSessionSttConfig(picks, 9, registry, language, platformDefault),
      ).toEqual(elevenLabs);
    });

    it('resolves each language independently', () => {
      const picks = { '1': ELEVENLABS_ID, '5': DEEPGRAM_ID };

      expect(
        resolveSessionSttConfig(picks, 1, registry, language, platformDefault),
      ).toEqual(elevenLabs);
      expect(
        resolveSessionSttConfig(picks, 5, registry, language, platformDefault),
      ).toEqual(deepgram);
    });

    it("falls back to the language's registry default when nothing is picked", () => {
      for (const picks of [undefined, null, {}, { '9': null }, { '9': '' }]) {
        expect(
          resolveSessionSttConfig(
            picks as any,
            9,
            registry,
            language,
            platformDefault,
          ),
        ).toEqual(google);
      }
    });

    it('falls back when the session language is unknown', () => {
      expect(
        resolveSessionSttConfig(
          { '9': ELEVENLABS_ID },
          undefined,
          registry,
          language,
          platformDefault,
        ),
      ).toEqual(google);
    });

    it('falls back when the referenced registry row is gone', () => {
      // Deleting a config a language points at is refused, but a simulation's
      // pick has no such guard — a dangling id must degrade, not throw.
      expect(
        resolveSessionSttConfig(
          { '9': '44444444-4444-4444-8444-444444444444' },
          9,
          registry,
          language,
          platformDefault,
        ),
      ).toEqual(google);
    });

    it('reads the pre-registry jsonb column when the language has no registry row', () => {
      const legacyLanguage = {
        sttConfigId: null,
        sttProviderConfig: {
          provider: 'sarvam',
          config: { model: 'saarika:v2.5' },
        },
      };

      expect(
        resolveSessionSttConfig(
          null,
          9,
          registry,
          legacyLanguage,
          platformDefault,
        ),
      ).toEqual(legacyLanguage.sttProviderConfig);
    });

    it('falls back to the platform default when the language is unconfigured', () => {
      expect(
        resolveSessionSttConfig(
          null,
          9,
          registry,
          { sttConfigId: null, sttProviderConfig: {} },
          platformDefault,
        ),
      ).toEqual(platformDefault);
      expect(
        resolveSessionSttConfig(null, 9, registry, null, platformDefault),
      ).toEqual(platformDefault);
    });

    it('ignores a registry row with no model rather than building a broken client', () => {
      // provider without a model makes ally-ai-learn pair the chosen provider
      // with the platform default model — a session that transcribes nothing.
      const brokenId = '55555555-5555-4555-8555-555555555555';
      const withBroken = new Map(registry);
      withBroken.set(brokenId, { provider: 'elevenlabs', config: {} });

      expect(
        resolveSessionSttConfig(
          { '9': brokenId },
          9,
          withBroken,
          language,
          platformDefault,
        ),
      ).toEqual(google);
    });

    it('ignores a picks map that is not an object shape', () => {
      expect(
        resolveSessionSttConfig(
          'elevenlabs' as any,
          9,
          registry,
          language,
          platformDefault,
        ),
      ).toEqual(google);
      expect(
        resolveSessionSttConfig(
          [] as any,
          9,
          registry,
          language,
          platformDefault,
        ),
      ).toEqual(google);
    });
  });

  describe('collectProviderConfigIds', () => {
    const PICK = '33333333-3333-4333-8333-333333333333';
    const LANG_DEFAULT = '22222222-2222-4222-8222-222222222222';

    it("gathers the simulation's pick and the language default", () => {
      expect(collectProviderConfigIds({ '9': PICK }, 9, LANG_DEFAULT)).toEqual([
        PICK,
        LANG_DEFAULT,
      ]);
    });

    it('skips a language the simulation has not overridden', () => {
      expect(collectProviderConfigIds({ '1': PICK }, 9, LANG_DEFAULT)).toEqual([
        LANG_DEFAULT,
      ]);
    });

    it('returns nothing to fetch when neither side references the registry', () => {
      expect(collectProviderConfigIds(null, 9, null)).toEqual([]);
      expect(collectProviderConfigIds({ '9': null }, 9, undefined)).toEqual([]);
      expect(collectProviderConfigIds({ '9': '' }, 9, undefined)).toEqual([]);
    });
  });
});

describe('resolveSessionLlmConfig — catalog rung', () => {
  const DEFAULT = { provider: 'openai', config: { model: 'gpt-4o-mini' } };
  const catalog = new Map<string, any>([
    ['m1', { provider: 'gemini', model: 'gemini-2.5-flash' }],
  ]);
  const configs = new Map<string, any>([
    ['c1', { provider: 'openai', config: { model: 'gpt-4o' } }],
  ]);

  it('prefers the catalog model over the legacy config row', () => {
    expect(
      resolveSessionLlmConfig(
        configs,
        { llmModelId: 'm1', llmConfigId: 'c1' },
        DEFAULT,
        catalog,
      ),
    ).toEqual({ provider: 'gemini', config: { model: 'gemini-2.5-flash' } });
  });

  // The config rung is retained precisely so an environment whose backfill did
  // not match keeps working.
  it('falls back to the config row when the catalog id does not resolve', () => {
    expect(
      resolveSessionLlmConfig(
        configs,
        { llmModelId: 'missing', llmConfigId: 'c1' },
        DEFAULT,
        catalog,
      ),
    ).toEqual({ provider: 'openai', config: { model: 'gpt-4o' } });
  });

  it('falls through to the legacy jsonb, then the platform default', () => {
    expect(
      resolveSessionLlmConfig(
        new Map(),
        {
          llmProviderConfig: {
            provider: 'google',
            config: { model: 'legacy' },
          },
        },
        DEFAULT,
        catalog,
      ),
    ).toEqual({ provider: 'google', config: { model: 'legacy' } });

    expect(resolveSessionLlmConfig(new Map(), {}, DEFAULT, catalog)).toEqual(
      DEFAULT,
    );
  });

  it('behaves as before when no catalog map is supplied', () => {
    expect(
      resolveSessionLlmConfig(
        configs,
        { llmModelId: 'm1', llmConfigId: 'c1' },
        DEFAULT,
      ),
    ).toEqual({ provider: 'openai', config: { model: 'gpt-4o' } });
  });

  it('ignores a catalog row missing a provider or model', () => {
    const broken = new Map<string, any>([['m1', { provider: 'gemini' }]]);
    expect(
      resolveSessionLlmConfig(
        configs,
        { llmModelId: 'm1', llmConfigId: 'c1' },
        DEFAULT,
        broken,
      ),
    ).toEqual({ provider: 'openai', config: { model: 'gpt-4o' } });
  });
});
