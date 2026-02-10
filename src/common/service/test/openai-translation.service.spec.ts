import { Test, TestingModule } from '@nestjs/testing';
import OpenAI from 'openai';
import { OpenAITranslationsService } from '../openai-translation.service';
import { AppConfigService } from '../../../config/config.service';

// Mock the OpenAI client
jest.mock('openai');

describe('OpenAITranslationsService', () => {
  let service: OpenAITranslationsService;
  let configService: jest.Mocked<AppConfigService>;
  let mockOpenAIClient: any;

  beforeEach(async () => {
    // Clear mocks before each test
    jest.clearAllMocks();

    // Create a mock OpenAI client with proper structure
    mockOpenAIClient = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    // Mock the OpenAI constructor to return our mock client
    (OpenAI as jest.MockedClass<typeof OpenAI>).mockImplementation(
      () => mockOpenAIClient,
    );

    configService = {
      openai: {
        apiKey: 'test-api-key',
        translationModel: 'gpt-4o-mini',
      },
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAITranslationsService,
        {
          provide: AppConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<OpenAITranslationsService>(OpenAITranslationsService);
  });

  describe('isConfigured', () => {
    it('should return true when API key is configured', () => {
      expect(service.isConfigured()).toBe(true);
    });

    it('should return false when API key is missing', () => {
      configService.openai.apiKey = '';
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('getLanguageConfig', () => {
    it('should return config for Hindi (hi)', () => {
      const config = service.getLanguageConfig('hi-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('hi');
      expect(config?.nativeName).toBe('Hindi');
    });

    it('should return config for Tamil (ta)', () => {
      const config = service.getLanguageConfig('ta-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('ta');
      expect(config?.nativeName).toBe('Tamil');
    });

    it('should return config for Telugu (te)', () => {
      const config = service.getLanguageConfig('te-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('te');
    });

    it('should return config for Kannada (kn)', () => {
      const config = service.getLanguageConfig('kn-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('kn');
    });

    it('should return config for Malayalam (ml)', () => {
      const config = service.getLanguageConfig('ml-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('ml');
    });

    it('should return config for Gujarati (gu)', () => {
      const config = service.getLanguageConfig('gu-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('gu');
    });

    it('should return config for Marathi (mr)', () => {
      const config = service.getLanguageConfig('mr-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('mr');
    });

    it('should return config for Bengali (bn)', () => {
      const config = service.getLanguageConfig('bn-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('bn');
    });

    it('should return config for Punjabi (pa)', () => {
      const config = service.getLanguageConfig('pa-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('pa');
    });

    it('should return config for Odia (or)', () => {
      const config = service.getLanguageConfig('or-IN');
      expect(config).toBeDefined();
      expect(config?.code).toBe('or');
    });

    it('should return null for unsupported language', () => {
      const config = service.getLanguageConfig('xx-XX');
      expect(config).toBeNull();
    });
  });

  describe('Language Configurations', () => {
    it('should have tone guidelines for all supported languages', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        expect(config).not.toBeNull();
        expect(config?.toneGuideline).toBeTruthy();
        expect(typeof config?.toneGuideline).toBe('string');
        expect(config?.toneGuideline.length).toBeGreaterThan(0);
        expect(config?.commonPreserveWords?.length).toBeGreaterThan(0);
      });
    });

    it('should have code-mixed name for all supported languages', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        expect(config?.codeMixedName).toBeTruthy();
        expect(typeof config?.codeMixedName).toBe('string');
        expect(config?.codeMixedName.length).toBeGreaterThan(0);
      });
    });

    it('should have consistent code format for all languages', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        // Code should be lowercase and 2 characters
        expect(config?.code).toBe(lang);
        expect(config?.code?.length).toBe(2);
        expect(config?.code).toBe(config?.code?.toLowerCase());
      });
    });

    it('should have native names for all languages', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      const expectedNames: Record<string, string> = {
        hi: 'Hindi',
        ta: 'Tamil',
        te: 'Telugu',
        kn: 'Kannada',
        ml: 'Malayalam',
        gu: 'Gujarati',
        mr: 'Marathi',
        bn: 'Bengali',
        pa: 'Punjabi',
        or: 'Odia',
      };

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        expect(config?.nativeName).toBe(expectedNames[lang]);
      });
    });

    it('should have preserve words array for all languages', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        expect(Array.isArray(config?.commonPreserveWords)).toBe(true);
        expect(config?.commonPreserveWords?.length).toBeGreaterThan(0);
        // All preserve words should be strings
        config?.commonPreserveWords?.forEach((word) => {
          expect(typeof word).toBe('string');
          expect(word.length).toBeGreaterThan(0);
        });
      });
    });

    it('should handle different language code formats', () => {
      // Test with lowercase
      expect(service.getLanguageConfig('hi')).not.toBeNull();
      expect(service.getLanguageConfig('hi')?.code).toBe('hi');

      // Test with uppercase
      expect(service.getLanguageConfig('HI-IN')).not.toBeNull();
      expect(service.getLanguageConfig('HI-IN')?.code).toBe('hi');

      // Test with mixed case
      expect(service.getLanguageConfig('Hi-In')).not.toBeNull();
      expect(service.getLanguageConfig('Hi-In')?.code).toBe('hi');

      // Test with just language code
      expect(service.getLanguageConfig('ta')).not.toBeNull();
      expect(service.getLanguageConfig('ta')?.code).toBe('ta');

      // Test with full locale
      expect(service.getLanguageConfig('ta-IN')).not.toBeNull();
      expect(service.getLanguageConfig('ta-IN')?.code).toBe('ta');
    });

    it('should return null for unsupported languages', () => {
      expect(service.getLanguageConfig('xx')).toBeNull();
      expect(service.getLanguageConfig('xx-XX')).toBeNull();
      expect(service.getLanguageConfig('fr')).toBeNull();
      expect(service.getLanguageConfig('es-ES')).toBeNull();
      expect(service.getLanguageConfig('pt')).toBeNull();
    });

    it('should return complete configuration object with all required properties', () => {
      const config = service.getLanguageConfig('hi-IN');

      // Verify all required properties exist
      expect(config).toHaveProperty('code');
      expect(config).toHaveProperty('nativeName');
      expect(config).toHaveProperty('codeMixedName');
      expect(config).toHaveProperty('toneGuideline');
      expect(config).toHaveProperty('commonPreserveWords');

      // Verify no property is undefined or null
      expect(config?.code).toBeDefined();
      expect(config?.nativeName).toBeDefined();
      expect(config?.codeMixedName).toBeDefined();
      expect(config?.toneGuideline).toBeDefined();
      expect(config?.commonPreserveWords).toBeDefined();
    });

    it('should maintain consistency across multiple calls', () => {
      const config1 = service.getLanguageConfig('hi-IN');
      const config2 = service.getLanguageConfig('hi-IN');

      expect(config1).toEqual(config2);
      expect(config1?.code).toEqual(config2?.code);
      expect(config1?.nativeName).toEqual(config2?.nativeName);
      expect(config1?.commonPreserveWords).toEqual(
        config2?.commonPreserveWords,
      );
    });

    it('should have unique language codes', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];
      const codes = languages.map(
        (lang) => service.getLanguageConfig(`${lang}-IN`)?.code,
      );

      // Remove undefined values
      const validCodes = codes.filter((code) => code !== undefined);

      // All codes should be unique
      const uniqueCodes = new Set(validCodes);
      expect(uniqueCodes.size).toBe(validCodes.length);
    });

    it('should have unique native names', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];
      const names = languages.map(
        (lang) => service.getLanguageConfig(`${lang}-IN`)?.nativeName,
      );

      // Remove undefined values
      const validNames = names.filter((name) => name !== undefined);

      // All names should be unique
      const uniqueNames = new Set(validNames);
      expect(uniqueNames.size).toBe(validNames.length);
    });

    it('should have valid tone guidelines with reasonable length', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        // Tone guideline should be substantial (not too short)
        expect(config?.toneGuideline.length).toBeGreaterThan(10);
      });
    });

    it('should have code-mixed names that mention English', () => {
      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const config = service.getLanguageConfig(`${lang}-IN`);
        // Code-mixed name should indicate mixing with English
        expect(
          config?.codeMixedName.toLowerCase().includes('english') ||
            config?.codeMixedName.toLowerCase().includes('code') ||
            config?.codeMixedName.toLowerCase().includes('mix'),
        ).toBe(true);
      });
    });
  });

  describe('resolveBaseLanguageCode', () => {
    it('should extract base language code from full locale code', () => {
      const resolveBaseLanguageCode = (
        service as any
      ).resolveBaseLanguageCode.bind(service);

      expect(resolveBaseLanguageCode('hi-IN')).toBe('hi');
      expect(resolveBaseLanguageCode('ta-IN')).toBe('ta');
      expect(resolveBaseLanguageCode('te-IN')).toBe('te');
    });

    it('should handle lowercase base codes', () => {
      const resolveBaseLanguageCode = (
        service as any
      ).resolveBaseLanguageCode.bind(service);

      expect(resolveBaseLanguageCode('HI-IN')).toBe('hi');
      expect(resolveBaseLanguageCode('TA-IN')).toBe('ta');
    });

    it('should return base code as-is if already present', () => {
      const resolveBaseLanguageCode = (
        service as any
      ).resolveBaseLanguageCode.bind(service);

      expect(resolveBaseLanguageCode('hi')).toBe('hi');
      expect(resolveBaseLanguageCode('ta')).toBe('ta');
    });
  });

  describe('getTemperatureForLanguage', () => {
    it('should return correct temperature for Hindi', () => {
      const getTemperatureForLanguage = (
        service as any
      ).getTemperatureForLanguage.bind(service);

      expect(getTemperatureForLanguage('hi')).toBe(0.62);
      expect(getTemperatureForLanguage('hi-IN')).toBe(0.62);
    });

    it('should return correct temperature for Punjabi', () => {
      const getTemperatureForLanguage = (
        service as any
      ).getTemperatureForLanguage.bind(service);

      expect(getTemperatureForLanguage('pa')).toBe(0.64);
      expect(getTemperatureForLanguage('pa-IN')).toBe(0.64);
    });

    it('should return correct temperature for Tamil', () => {
      const getTemperatureForLanguage = (
        service as any
      ).getTemperatureForLanguage.bind(service);

      expect(getTemperatureForLanguage('ta')).toBe(0.63);
      expect(getTemperatureForLanguage('ta-IN')).toBe(0.63);
    });

    it('should return correct temperature for all supported languages', () => {
      const getTemperatureForLanguage = (
        service as any
      ).getTemperatureForLanguage.bind(service);

      const temperatureMap: Record<string, number> = {
        hi: 0.62,
        pa: 0.64,
        ta: 0.63,
        ml: 0.64,
        te: 0.61,
        kn: 0.61,
        mr: 0.6,
        bn: 0.6,
        gu: 0.6,
        or: 0.61,
      };

      Object.entries(temperatureMap).forEach(([lang, expectedTemp]) => {
        expect(getTemperatureForLanguage(lang)).toBe(expectedTemp);
      });
    });

    it('should return default temperature for unknown language', () => {
      const getTemperatureForLanguage = (
        service as any
      ).getTemperatureForLanguage.bind(service);

      expect(getTemperatureForLanguage('xx')).toBe(0.61);
      expect(getTemperatureForLanguage('fr')).toBe(0.61);
    });

    it('should return temperature within valid range', () => {
      const getTemperatureForLanguage = (
        service as any
      ).getTemperatureForLanguage.bind(service);

      const languages = [
        'hi',
        'ta',
        'te',
        'kn',
        'ml',
        'gu',
        'mr',
        'bn',
        'pa',
        'or',
      ];

      languages.forEach((lang) => {
        const temp = getTemperatureForLanguage(lang);
        expect(temp).toBeGreaterThanOrEqual(0.58);
        expect(temp).toBeLessThanOrEqual(0.68);
      });
    });
  });

  describe('buildSystemPrompt', () => {
    it('should return valid system prompt for language', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const prompt = buildSystemPrompt('hi-IN');

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain('Hindi');
      expect(prompt).toContain('NATIVE SCRIPT');
    });

    it('should include language name in prompt', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const hiPrompt = buildSystemPrompt('hi-IN');
      const taPrompt = buildSystemPrompt('ta-IN');

      expect(hiPrompt).toContain('Hindi');
      expect(taPrompt).toContain('Tamil');
    });

    it('should include code-mixing guidance in prompt', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const prompt = buildSystemPrompt('hi-IN');

      expect(prompt).toContain('CODE-MIX');
      expect(prompt).toContain('native script');
      expect(prompt).toContain('English');
    });

    it('should include scenario context when provided', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const scenarioContext = {
        title: 'Frustrated Employee',
        personality: 'Highly sensitive',
        tone: 'Anxious',
      };

      const prompt = buildSystemPrompt('hi-IN', scenarioContext);

      expect(prompt).toContain('Frustrated Employee');
      expect(prompt).toContain('Highly sensitive');
      expect(prompt).toContain('Anxious');
      expect(prompt).toContain('COMPLETE SCENARIO CONTEXT');
      // Verify emoji headers from optimized code
      expect(prompt).toContain('📛 CHARACTER');
      expect(prompt).toContain('👤 PERSONALITY');
      expect(prompt).toContain('💭 EMOTIONAL TONE');
    });

    it('should include all demographics fields when provided', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const scenarioContext = {
        title: 'Test Character',
        age: '28',
        gender: 'Female',
        genderIdentity: 'Woman',
        sexualOrientation: 'Heterosexual',
        profession: 'Software Engineer',
      };

      const prompt = buildSystemPrompt('hi-IN', scenarioContext);

      expect(prompt).toContain('👥 DEMOGRAPHICS');
      expect(prompt).toContain('Age: 28');
      expect(prompt).toContain('Gender: Female');
      expect(prompt).toContain('Gender Identity: Woman');
      expect(prompt).toContain('Sexual Orientation: Heterosexual');
      expect(prompt).toContain('Profession: Software Engineer');
    });

    it('should include opening statements when provided', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const scenarioContext = {
        title: 'Anxious Student',
        openingStatements: [
          'I am really worried about my exam',
          'I do not know how to manage my stress',
        ],
      };

      const prompt = buildSystemPrompt('hi-IN', scenarioContext);

      expect(prompt).toContain('💬 TYPICAL OPENING STATEMENTS');
      expect(prompt).toContain('I am really worried about my exam');
      expect(prompt).toContain('I do not know how to manage my stress');
    });

    it('should include situation context and training focus when provided', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const scenarioContext = {
        title: 'Career Changer',
        context: 'Person transitioning to a new career at age 35',
        description: 'Help them overcome fears about starting over',
      };

      const prompt = buildSystemPrompt('hi-IN', scenarioContext);

      expect(prompt).toContain('🌍 SITUATION CONTEXT');
      expect(prompt).toContain('Person transitioning to a new career');
      expect(prompt).toContain('🎯 TRAINING FOCUS');
      expect(prompt).toContain('Help them overcome fears');
    });

    it('should handle empty scenario context', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const prompt = buildSystemPrompt('hi-IN', {});

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should not include scenario context section when context is null', () => {
      const buildSystemPrompt = (service as any).buildSystemPrompt.bind(
        service,
      );

      const prompt = buildSystemPrompt('hi-IN', null);

      expect(prompt).not.toContain('COMPLETE SCENARIO CONTEXT');
    });
  });

  describe('buildUserPrompt', () => {
    it('should return valid user prompt for JSON translation', () => {
      const buildUserPrompt = (service as any).buildUserPrompt.bind(service);

      const sourceObject = { title: 'Test' };
      const prompt = buildUserPrompt(sourceObject, 'hi-IN');

      expect(prompt).toBeDefined();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('should include language name in user prompt', () => {
      const buildUserPrompt = (service as any).buildUserPrompt.bind(service);

      const sourceObject = { title: 'Test' };
      const hiPrompt = buildUserPrompt(sourceObject, 'hi-IN');
      const taPrompt = buildUserPrompt(sourceObject, 'ta-IN');

      expect(hiPrompt).toContain('Hindi');
      expect(taPrompt).toContain('Tamil');
    });

    it('should include JSON in user prompt', () => {
      const buildUserPrompt = (service as any).buildUserPrompt.bind(service);

      const sourceObject = { title: 'Test Title', description: 'Test Desc' };
      const prompt = buildUserPrompt(sourceObject, 'hi-IN');

      expect(prompt).toContain('Test Title');
      expect(prompt).toContain('Test Desc');
      expect(prompt).toContain('JSON');
    });

    it('should include rewrite instructions in prompt', () => {
      const buildUserPrompt = (service as any).buildUserPrompt.bind(service);

      const sourceObject = { title: 'Test' };
      const prompt = buildUserPrompt(sourceObject, 'hi-IN');

      expect(prompt).toContain('Rewrite');
      expect(prompt).toContain('NATURAL');
      expect(prompt).toContain('CASUAL');
    });

    it('should preserve JSON structure requirement', () => {
      const buildUserPrompt = (service as any).buildUserPrompt.bind(service);

      const sourceObject = { title: 'Test' };
      const prompt = buildUserPrompt(sourceObject, 'hi-IN');

      expect(prompt).toContain('structure');
      expect(prompt).toContain('keys');
    });
  });

  describe('translateObjectToLanguages', () => {
    it('should return empty object for empty language array', async () => {
      const result = await service.translateObjectToLanguages(
        { title: 'Test' },
        [],
        null,
      );

      expect(result).toEqual({});
    });

    it('should return empty object for no language codes', async () => {
      const result = await service.translateObjectToLanguages(
        { title: 'Test' },
        null as any,
        null,
      );

      expect(result).toEqual({});
    });

    it('should handle translation with scenario context', async () => {
      // Mock the private methods
      const buildSystemPrompt = jest.spyOn(service as any, 'buildSystemPrompt');
      const buildUserPrompt = jest.spyOn(service as any, 'buildUserPrompt');

      const sourceObject = { title: 'Test' };
      const scenarioContext = { title: 'Character' };

      try {
        await service.translateObjectToLanguages(
          sourceObject,
          ['hi'],
          scenarioContext,
        );
      } catch {
        // Expected to fail due to missing OpenAI client mock
      }

      expect(buildSystemPrompt).toHaveBeenCalledWith('hi', scenarioContext);

      buildSystemPrompt.mockRestore();
      buildUserPrompt.mockRestore();
    });
  });

  describe('fetchTranslations', () => {
    it('should successfully fetch and parse translations from OpenAI', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({ title: 'परीक्षण' }),
            },
          },
        ],
      });

      const jsonString = JSON.stringify({ title: 'Test' });
      const systemPrompt = 'Translate to Hindi';
      const userPrompt = 'Rewrite this in Hindi';

      const result = await (service as any).fetchTranslations(
        [jsonString],
        'hi',
        systemPrompt,
        userPrompt,
      );

      // fetchTranslations returns string[] where each element is a JSON string
      expect(result).toEqual([JSON.stringify({ title: 'परीक्षण' })]);
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith({
        model: 'gpt-4o-mini',
        temperature: 0.62,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });
    });

    it('should return original object on JSON parse error', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'Invalid JSON response',
            },
          },
        ],
      });

      const originalJsonString = JSON.stringify({ title: 'Test' });

      const result = await (service as any).fetchTranslations(
        [originalJsonString],
        'hi',
        'System',
        'User',
      );

      // Should return original array on parse error
      expect(result).toEqual([originalJsonString]);
    });

    it('should handle empty OpenAI response gracefully', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '',
            },
          },
        ],
      });

      const originalJsonString = JSON.stringify({ title: 'Test' });

      const result = await (service as any).fetchTranslations(
        [originalJsonString],
        'hi',
        'System',
        'User',
      );

      // Should return original array on empty response
      expect(result).toEqual([originalJsonString]);
    });

    it('should handle API errors and return original object', async () => {
      mockOpenAIClient.chat.completions.create.mockRejectedValueOnce(
        new Error('API Error'),
      );

      const originalJsonString = JSON.stringify({ title: 'Test' });

      const result = await (service as any).fetchTranslations(
        [originalJsonString],
        'hi',
        'System',
        'User',
      );

      // Should return original array on API error
      expect(result).toEqual([originalJsonString]);
    });

    it('should use correct temperature for each language', async () => {
      const languages = [
        { code: 'hi', expectedTemp: 0.62 },
        { code: 'pa', expectedTemp: 0.64 },
        { code: 'ta', expectedTemp: 0.63 },
        { code: 'ml', expectedTemp: 0.64 },
      ];

      const jsonString = JSON.stringify({ title: 'Test' });

      for (const { code, expectedTemp } of languages) {
        mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({}) } }],
        });

        await (service as any).fetchTranslations(
          [jsonString],
          code,
          'System',
          'User',
        );

        expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({
            temperature: expectedTemp,
          }),
        );
      }
    });

    it('should handle response with extra whitespace', async () => {
      const responseContent =
        '  \n\n' + JSON.stringify({ title: 'परीक्षण' }) + '\n\n  ';
      mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: responseContent,
            },
          },
        ],
      });

      const result = await (service as any).fetchTranslations(
        [JSON.stringify({ title: 'Test' })],
        'hi',
        'System',
        'User',
      );

      // fetchTranslations returns content as-is if it's valid JSON (even with whitespace)
      expect(result).toEqual([responseContent]);
    });

    it('should preserve complex nested objects', async () => {
      const expectedTranslation = {
        title: 'परीक्षण',
        nested: {
          description: 'विवरण',
          items: ['आइटम 1', 'आइटम 2'],
        },
      };

      mockOpenAIClient.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify(expectedTranslation),
            },
          },
        ],
      });

      const result = await (service as any).fetchTranslations(
        [
          JSON.stringify({
            title: 'Test',
            nested: { description: 'Description' },
          }),
        ],
        'hi',
        'System',
        'User',
      );

      // Should return the translated JSON string in array
      expect(result).toEqual([JSON.stringify(expectedTranslation)]);
    });
  });
});
