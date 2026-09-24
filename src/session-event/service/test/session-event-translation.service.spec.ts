import { Test, TestingModule } from '@nestjs/testing';
import { SessionEventTranslationService } from '../session-event-translation.service';
import { GoogleTranslationsService } from 'src/common/service/google-translation.service';
import { OpenAITranslationsService } from 'src/common/service/openai-translation.service';
import { SharedLanguageService } from 'src/language/service/shared-language.service';
import { ScenarioSharedService } from 'src/learn/service/scenario-shared.service';
import { SessionEventTranslationsRepository } from '../../repository/session-event-translation.repository';
import { SessionEventSharedService } from '../session-event-shared.service';
import { SessionEvents } from '../../entity/session-events.entity';
import {
  DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
  DETECTION_DATA_TRANSLATABLE_PATHS,
} from '../../constants/event.constant';

describe('SessionEventTranslationService', () => {
  let service: SessionEventTranslationService;
  let googleTranslationService: jest.Mocked<GoogleTranslationsService>;
  let sharedLanguageService: jest.Mocked<SharedLanguageService>;
  let scenarioSharedService: jest.Mocked<ScenarioSharedService>;
  let sessionEventTranslationsRepository: jest.Mocked<SessionEventTranslationsRepository>;
  let sessionEventSharedService: jest.Mocked<SessionEventSharedService>;

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
          provide: OpenAITranslationsService,
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
        {
          provide: SessionEventSharedService,
          useValue: {
            getSessionEventsTranslationsByScenarioId: jest.fn(),
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
    sessionEventSharedService = module.get(SessionEventSharedService);
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
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
          {
            id: 2,
            translationCode: 'es',
            value: 'es-ES',
            label: 'Spanish (Spain)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
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
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
          es: {
            id: 2,
            translationCode: 'es',
            value: 'es-ES',
            label: 'Spanish (Spain)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
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

    it('should filter out english language variants before translation', async () => {
      // Mock dependencies
      scenarioSharedService.getUniqueLanguagesFromScenarioTranslations.mockResolvedValue(
        [1, 2, 3, 4, 5],
      );
      sharedLanguageService.getValidLanguages.mockResolvedValue({
        languages: [
          {
            id: 1,
            translationCode: 'en',
            value: 'en',
            label: 'English',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
          {
            id: 2,
            translationCode: 'es',
            value: 'es-ES',
            label: 'Spanish (Spain)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
          {
            id: 3,
            translationCode: 'en-US',
            value: 'en-US',
            label: 'English (US)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
          {
            id: 4,
            translationCode: 'fr',
            value: 'fr-CA',
            label: 'French (Canada)',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
          {
            id: 5,
            translationCode: 'kl',
            value: 'bren',
            label: 'Klingon',
            active: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            llmProviderConfig: {},
            sttProviderConfig: {},
            evalConfig: {},
          },
        ],
        languagesMap: {},
      });
      googleTranslationService.translateObjectToLanguages.mockResolvedValue({});
      sessionEventTranslationsRepository.getSessionEventTranslationsBySessionEventId.mockResolvedValue(
        [],
      );

      // Call the method
      await service.createUpdateSessionEventTranslations([mockSessionEvent]);

      // Verify that translateObjectToLanguages was called with non-english languages
      const calls =
        googleTranslationService.translateObjectToLanguages.mock.calls[0];
      const languages = calls[1];
      expect(languages).toContain('es');
      expect(languages).toContain('fr');
      expect(languages).toContain('kl');
      expect(languages).not.toContain('en');
      expect(languages).not.toContain('en-US');
    });
  });

  describe('getSessionEventsTranslationsByScenarioId', () => {
    it('should return session events with translations for the given scenario and language', async () => {
      const mockResult = [
        {
          id: 'test-event-1',
          name: 'Test Event',
          description: 'Test Description',
          score: 100,
        } as SessionEvents,
      ];

      sessionEventSharedService.getSessionEventsTranslationsByScenarioId.mockResolvedValue(
        mockResult,
      );

      const result = await service.getSessionEventsTranslationsByScenarioId(
        1,
        1,
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('test-event-1');
      expect(
        sessionEventSharedService.getSessionEventsTranslationsByScenarioId,
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

  describe('binary-classifier few-shot examples', () => {
    // positiveExamples / negativeExamples are `[{ text }]`, the only shape in
    // detectionData that is neither a string nor a string array. Before they
    // were unwrapped here, adding them to DETECTION_DATA_TRANSLATABLE_PATHS was
    // a silent no-op: extraction accepted only strings, so every non-English
    // session calibrated its classifier against English examples.
    const detectionData = {
      className: 'Open-ended question',
      positiveExamples: [
        { text: 'What was that like for you?' },
        { text: 'Tell me more.' },
      ],
      negativeExamples: [{ text: 'Are you okay?' }],
      minUtteranceLength: 5,
    };

    it('unwraps {text} objects to plain strings for the translator', () => {
      const result = (service as any).extractTranslatableFields(
        detectionData,
        DETECTION_DATA_TRANSLATABLE_PATHS,
        DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
      );

      expect(result.translatable.positiveExamples).toEqual([
        'What was that like for you?',
        'Tell me more.',
      ]);
      expect(result.translatable.negativeExamples).toEqual(['Are you okay?']);
      expect(result.translatable.className).toBe('Open-ended question');
    });

    it('keeps the English examples in passthrough as the fallback', () => {
      // Unlike className, these are NOT deleted from passthrough. The runtime
      // COALESCEs a translation row's detectionData wholesale, so a key the
      // translation lacks is a key that session does not have at all — which
      // for the few-shot block means a silent drop to zero-shot.
      const result = (service as any).extractTranslatableFields(
        detectionData,
        DETECTION_DATA_TRANSLATABLE_PATHS,
        DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
      );

      expect(result.passthrough.positiveExamples).toEqual(
        detectionData.positiveExamples,
      );
      expect(result.passthrough.negativeExamples).toEqual(
        detectionData.negativeExamples,
      );
      // className keeps the existing delete-on-extract behaviour.
      expect(result.passthrough.className).toBeUndefined();
      expect(result.passthrough.minUtteranceLength).toBe(5);
    });

    it('re-wraps the translated strings as {text} objects', () => {
      const result = (service as any).mergeTranslatedFields(
        { positiveExamples: [{ text: 'What was that like for you?' }] },
        { positiveExamples: ['आपको यह कैसा लगा?'] },
        DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
      );

      expect(result.positiveExamples).toEqual([{ text: 'आपको यह कैसा लगा?' }]);
    });

    it('leaves the English original in place when the translation is unusable', () => {
      const english = [{ text: 'What was that like for you?' }];

      for (const bad of [[], '', 'not an array', [''], [null]]) {
        const result = (service as any).mergeTranslatedFields(
          { positiveExamples: english },
          { positiveExamples: bad as any },
          DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
        );
        expect(result.positiveExamples).toEqual(english);
      }
    });

    it('ignores an examples array that is not shaped like {text}', () => {
      const result = (service as any).extractTranslatableFields(
        { positiveExamples: ['a bare string'] },
        DETECTION_DATA_TRANSLATABLE_PATHS,
        DETECTION_DATA_TEXT_OBJECT_ARRAY_PATHS,
      );

      expect(result.translatable.positiveExamples).toBeUndefined();
      expect(result.passthrough.positiveExamples).toEqual(['a bare string']);
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
