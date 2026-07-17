import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OpenAIAutofillService } from '../openai-autofil-service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';

const mockCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockCreate } },
  })),
}));

describe('OpenAIAutofillService', () => {
  let service: OpenAIAutofillService;
  let promptSharedService: jest.Mocked<PromptSharedService>;

  beforeEach(async () => {
    mockCreate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenAIAutofillService,
        {
          provide: AppConfigService,
          useValue: {
            openai: { apiKey: 'test-key', autofillModel: 'gpt-4o-mini' },
          },
        },
        {
          provide: PromptSharedService,
          useValue: { getPromptByCode: jest.fn() },
        },
        {
          provide: LlmUsageService,
          useValue: { record: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(OpenAIAutofillService);
    promptSharedService = module.get(PromptSharedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('enhanceFieldContent', () => {
    it('renders the prompt-management template and strips markdown fences', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        'Field: {{fieldLabel}}\nContent: {{currentValue}}\nGuidance: {{guidance}}',
      );
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '```\nImproved text.\n```' } }],
        usage: {},
      });

      const result = await service.enhanceFieldContent(
        'characterProfileText' as any,
        'enhance_field',
        {
          fieldLabel: 'Character backstory',
          currentValue: 'Original backstory.',
          guidance: 'Make it shorter',
        },
        false,
      );

      expect(result).toBe('Improved text.');
      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('Original backstory.');
      expect(prompt).toContain('Make it shorter');
    });

    it('requests JSON mode when expectJson is true', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        '{{currentGuidelines}}',
      );
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '{"name":"X","guidelines":"Y"}' } }],
        usage: {},
      });

      await service.enhanceFieldContent(
        'state' as any,
        'enhance_state',
        { currentName: 'X', currentGuidelines: 'Y', guidance: 'tighten' },
        true,
      );

      expect(mockCreate.mock.calls[0][0].response_format).toEqual({
        type: 'json_object',
      });
    });

    it('throws when the prompt template is missing', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(null);
      await expect(
        service.enhanceFieldContent(
          'characterProfileText' as any,
          'enhance_field',
          {},
          false,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when the model returns an empty response', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue('{{currentValue}}');
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '' } }],
        usage: {},
      });

      await expect(
        service.enhanceFieldContent(
          'characterProfileText' as any,
          'enhance_field',
          { currentValue: 'x' },
          false,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });
});
