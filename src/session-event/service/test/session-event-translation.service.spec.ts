import { Test, TestingModule } from '@nestjs/testing';
import { SessionEventTranslationService } from '../session-event-translation.service';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { SessionEventTranslationsRepository } from '../../repository/session-event-translation.repository';
import { SessionEvents } from '../../entity/session-events.entity';

describe('SessionEventTranslationService', () => {
  let service: SessionEventTranslationService;
  let googleTranslationService: jest.Mocked<GoogleTranslationsService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let sessionEventTranslationsRepository: jest.Mocked<SessionEventTranslationsRepository>;

  const mockSessionEvent: SessionEvents = {
    id: 'test-event-1',
    message: 'Test message',
    branchInstruction: 'Test branch instruction',
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionEventTranslationService,
        {
          provide: GoogleTranslationsService,
          useValue: {
            translateObjectToLanguages: jest.fn(),
          },
        },
        {
          provide: SharedLanguageService,
          useValue: {
            getValidLanguages: jest.fn(),
          },
        },
        {
          provide: ScenarioSharedService,
          useValue: {
            getUniqueLanguagesFromScenarioTranslations: jest.fn(),
          },
        },
        {
          provide: SessionEventTranslationsRepository,
          useValue: {
            getSessionEventTranslationsBySessionEventId: jest.fn(),
            createSessionEventTranslations: jest.fn(),
            updateSessionTranslations: jest.fn(),
            getSessionEventTranslationsByForMetaData: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionEventTranslationService>(
      SessionEventTranslationService,
    );
    googleTranslationService = module.get(GoogleTranslationsService);
    sharedLanguageService = module.get(SharedLanguageService);
    scenarioSharedService = module.get(ScenarioSharedService);
    sessionEventTranslationsRepository = module.get(
      SessionEventTranslationsRepository,
    );
  });

  describe('createUpdateSessionEventTranslations', () => {
    it('should create and update translations for session events', async () => {
      // Mock dependencies
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [1, 2],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [
          {
            id: 1,
            translationCode: 'en',
            value: 'en-IN',
            label: 'English (India)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 2,
            translationCode: 'es',
            value: 'es-ES',
            label: 'Spanish (Spain)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        languagesMap: {
          en: {
            id: 1,
            translationCode: 'en',
            value: 'en-IN',
            label: 'English (India)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          es: {
            id: 2,
            translationCode: 'es',
            value: 'es-ES',
            label: 'Spanish (Spain)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      });
      googleTranslationService.translateObjectToLanguages.mockResolvedValue({
        en: {
          message: 'English message',
          branchInstruction: 'English instruction',
        },
        es: {
          message: 'Mensaje en español',
          branchInstruction: 'Instrucción en español',
        },
      });
      sessionEventTranslationsRepository.getSessionEventTranslationsBySessionEventId.mockResolvedValue(
        [],
      );

      // Call the method
      await service.createUpdateSessionEventTranslations([mockSessionEvent]);

      // Verify the calls
      expect(
        scenarioSharedService.getUniqueLanguagesFromScenarioTranslations,
      ).toHaveBeenCalled();
      expect(sharedLanguageService.getValidLanguages).toHaveBeenCalledWith([
        1, 2,
      ]);
      expect(
        googleTranslationService.translateObjectToLanguages,
      ).toHaveBeenCalled();
      expect(
        sessionEventTranslationsRepository.createSessionEventTranslations,
      ).toHaveBeenCalled();
    });
  });

  describe('getSessionEventsTranslationsByScenarioId', () => {
    it('should return session events with translations for the given scenario and language', async () => {
      const mockResult = [
        {
          sessionEvents_id: 'test-event-1',
          sessionEvents_name: 'Test Event',
          sessionEvents_description: 'Test Description',
          sessionEvents_score: 100,
          scenarioEvents_score: null,
          scenarioEvents_feedbackStatus: true,
          scenarioEvents_emoji: '😊',
          sessionEvents_emoji: '😐',
          scenarioEvents_message: 'Scenario Message',
          sessionEvents_message: 'Session Message',
          scenarioEvents_branchingStatus: true,
          scenarioEvents_branchInstruction: 'Scenario Branch',
          sessionEvents_branchInstruction: 'Session Branch',
          sessionEvents_detectionType: 'TYPE',
          sessionEvents_detectionData: { key: 'value' },
          sessionEvents_visibilityType: 'VISIBLE',
          sessionEvents_speaker: 'SYSTEM',
          sessionEvents_createdAt: new Date(),
          sessionEvents_updatedAt: new Date(),
          sessionEvents_eventCode: 'TEST_EVENT',
        },
      ];

      sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData.mockResolvedValue(
        mockResult,
      );

      const result = await service.getSessionEventsTranslationsByScenarioId(
        1,
        1,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-event-1');
      expect(
        sessionEventTranslationsRepository.getSessionEventTranslationsByForMetaData,
      ).toHaveBeenCalledWith(1, 1);
    });
  });

  describe('sanitizeSessionEventMetadata', () => {
    it('should sanitize session event metadata', () => {
      const metadata = {
        message: '  Test message  ',
        branchInstruction: '  Test branch  ',
        detectionData: { key: 'value' },
      };

      const result = (service as any).sanitizeSessionEventMetadata(metadata);

      expect(result).toEqual({
        message: 'Test message',
        branchInstruction: 'Test branch',
        detectionData: { key: 'value' },
      });
    });

    it('should remove empty strings and null values', () => {
      const metadata = {
        message: '   ',
        branchInstruction: null,
        detectionData: null,
      };

      const result = (service as any).sanitizeSessionEventMetadata(metadata);

      expect(result).toEqual({});
    });

    it('should ignore undefined values', () => {
      const metadata = {
        message: undefined,
        branchInstruction: undefined,
        detectionData: undefined,
      };

      const result = (service as any).sanitizeSessionEventMetadata(metadata);

      expect(result).toEqual({});
    });

    it('should preserve non-string metadata fields', () => {
      const metadata = {
        detectionData: { foo: 'bar' },
      };

      const result = (service as any).sanitizeSessionEventMetadata(metadata);

      expect(result).toEqual({
        detectionData: { foo: 'bar' },
      });
    });

    it('should dynamically sanitize additional string fields', () => {
      const metadata = {
        message: '  hello ',
        customField: '  world  ',
      };

      const result = (service as any).sanitizeSessionEventMetadata(metadata);

      expect(result).toEqual({
        message: 'hello',
        customField: 'world',
      });
    });
  });

  describe('extractTranslatableFields', () => {
    it('should extract translatable fields from metadata', () => {
      const metadata = {
        detectionData: {
          sentences: ['This is a test.', 'Another sentence.'],
          className: 'TestClass',
          type: 'TestType',
        },
      };

      const allowedPaths = [
        'detectionData.sentences',
        'detectionData.className',
      ];

      const result = (service as any).extractTranslatableFields(
        metadata,
        allowedPaths,
      );

      expect(result.translatable).toEqual({
        'detectionData.sentences': ['This is a test.', 'Another sentence.'],
        'detectionData.className': 'TestClass',
      });

      expect(result.passthrough).toEqual({
        detectionData: {
          type: 'TestType',
        },
      });
    });
  });

  describe('mergeTranslatedFields', () => {
    it('should merge translated fields into passthrough using dot paths', () => {
      const passthrough = {
        detectionData: {
          type: 'TestType',
        },
      };

      const translated = {
        'detectionData.sentences': [
          'Translated sentence 1',
          'Translated sentence 2',
        ],
        'detectionData.className': 'TranslatedClass',
      };

      const result = (service as any).mergeTranslatedFields(
        passthrough,
        translated,
      );

      expect(result).toEqual({
        detectionData: {
          type: 'TestType',
          sentences: ['Translated sentence 1', 'Translated sentence 2'],
          className: 'TranslatedClass',
        },
      });
    });

    it('should return passthrough unchanged when translated is undefined', () => {
      const passthrough = {
        detectionData: {
          type: 'TestType',
        },
      };

      const result = (service as any).mergeTranslatedFields(
        passthrough,
        undefined,
      );

      expect(result).toEqual(passthrough);
    });

    it('should not mutate the original passthrough object', () => {
      const passthrough = {
        detectionData: {
          type: 'TestType',
        },
      };

      const translated = {
        'detectionData.className': 'NewClass',
      };

      const result = (service as any).mergeTranslatedFields(
        passthrough,
        translated,
      );

      expect(result).not.toBe(passthrough);
      expect(passthrough).toEqual({
        detectionData: {
          type: 'TestType',
        },
      });
    });

    it('should overwrite existing values at the same path', () => {
      const passthrough = {
        detectionData: {
          className: 'OldClass',
        },
      };

      const translated = {
        'detectionData.className': 'NewClass',
      };

      const result = (service as any).mergeTranslatedFields(
        passthrough,
        translated,
      );

      expect(result).toEqual({
        detectionData: {
          className: 'NewClass',
        },
      });
    });
  });
});
