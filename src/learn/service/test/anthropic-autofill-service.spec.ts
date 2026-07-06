import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { AnthropicAutofillService } from '../anthropic-autofill.service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { LlmUsageService } from 'src/analytics/service/llm-usage.service';
import { GeneratableField } from 'src/learn/enum/generatable-field.enum';
import { BehaviorInstructionCategory } from 'src/learn/enum/behavior-instruction.enum';

const mockCreate = jest.fn();
const mockModelsList = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
    models: { list: mockModelsList },
  })),
}));

const mockBehaviorStateInstructions = [
  { stateId: '1', instruction: 'Phase 1 reaction text for tests.' },
  { stateId: '2', instruction: 'Phase 2 reaction text for tests.' },
  { stateId: '3', instruction: 'Phase 3 reaction text for tests.' },
  { stateId: '4', instruction: 'Phase 4 reaction text for tests.' },
];

const makeAnthropicResponse = (text: string) => ({
  content: [{ type: 'text', text }],
});

describe('AnthropicAutofillService', () => {
  let service: AnthropicAutofillService;
  let promptSharedService: jest.Mocked<PromptSharedService>;

  const scenarioContext = {
    title: 'Anxiety Counseling',
    name: 'John',
    age: 30,
    gender: 'Male',
  };

  beforeEach(async () => {
    mockCreate.mockReset();
    mockModelsList.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnthropicAutofillService,
        {
          provide: AppConfigService,
          useValue: {
            anthropic: {
              apiKey: 'test-key',
              autofillModel: 'claude-sonnet-4-6',
            },
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

    service = module.get(AnthropicAutofillService);
    promptSharedService = module.get(PromptSharedService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generateFieldContent', () => {
    it('should throw NotFoundException when prompt template is not found', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(null);

      await expect(
        service.generateFieldContent(
          GeneratableField.DESCRIPTION,
          'MISSING_CODE',
          scenarioContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw InternalServerErrorException when Anthropic returns empty content', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        'Generate: {{ title }}',
      );
      mockCreate.mockResolvedValue(makeAnthropicResponse(''));

      await expect(
        service.generateFieldContent(
          GeneratableField.DESCRIPTION,
          'PROMPT_CODE',
          scenarioContext,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should throw InternalServerErrorException when content block is missing', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue('prompt');
      mockCreate.mockResolvedValue({ content: [] });

      await expect(
        service.generateFieldContent(
          GeneratableField.DESCRIPTION,
          'PROMPT_CODE',
          scenarioContext,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should re-throw errors from Anthropic client', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue('prompt');
      mockCreate.mockRejectedValue(new Error('API rate limit'));

      await expect(
        service.generateFieldContent(
          GeneratableField.DESCRIPTION,
          'PROMPT_CODE',
          scenarioContext,
        ),
      ).rejects.toThrow('API rate limit');
    });

    it('should use modelOverride when provided', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue('prompt');
      mockCreate.mockResolvedValue(makeAnthropicResponse('ok'));

      await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
        undefined,
        'claude-haiku-4-5',
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-haiku-4-5' }),
      );
    });

    it('should fall back to configured default model when no override', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue('prompt');
      mockCreate.mockResolvedValue(makeAnthropicResponse('ok'));

      await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'claude-sonnet-4-6' }),
      );
    });
  });

  describe('extractContent', () => {
    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('template');
    });

    it('should return raw string for CHARACTER_PROFILE_TEXT', async () => {
      const raw = 'John is a 30-year-old male...';
      mockCreate.mockResolvedValue(makeAnthropicResponse(raw));

      const result = await service.generateFieldContent(
        GeneratableField.CHARACTER_PROFILE_TEXT,
        'CODE',
        scenarioContext,
      );

      expect(result).toBe(raw);
    });

    it('should return raw string for DESCRIPTION', async () => {
      const raw = 'This scenario focuses on anxiety...';
      mockCreate.mockResolvedValue(makeAnthropicResponse(raw));

      const result = await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
      );

      expect(result).toBe(raw);
    });

    it('should strip markdown fences before parsing JSON fields', async () => {
      const statements = ['Hello there.', 'I need help.'];
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(
          '```json\n' + JSON.stringify({ statements }) + '\n```',
        ),
      );

      const result = await service.generateFieldContent(
        GeneratableField.OPENING_STATEMENTS,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual(statements);
    });

    it('should parse clean JSON without fences for OPENING_STATEMENTS', async () => {
      const statements = ['Hello there.', 'I need help.'];
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify({ statements })),
      );

      const result = await service.generateFieldContent(
        GeneratableField.OPENING_STATEMENTS,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual(statements);
    });

    it('should parse and return array of state instruction items for STATE_INSTRUCTIONS', async () => {
      const rawResponse = {
        state_1: {
          name: 'Calm',
          instruction: 'Be calm',
          dialogues: ['I am fine.'],
        },
        state_2: {
          name: 'Worried',
          instruction: 'Show worry',
          dialogues: ['I am worried.'],
        },
        state_3: {
          name: 'Escalated',
          instruction: 'Escalate',
          dialogues: ['I cannot cope.'],
        },
        state_4: {
          name: 'Crisis',
          instruction: 'Crisis',
          dialogues: ['Help me.'],
        },
      };
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify(rawResponse)),
      );

      const result = await service.generateFieldContent(
        GeneratableField.STATE_INSTRUCTIONS,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual([
        {
          stateId: '1',
          name: 'Calm',
          instruction: 'Be calm',
          dialogues: ['I am fine.'],
        },
        {
          stateId: '2',
          name: 'Worried',
          instruction: 'Show worry',
          dialogues: ['I am worried.'],
        },
        {
          stateId: '3',
          name: 'Escalated',
          instruction: 'Escalate',
          dialogues: ['I cannot cope.'],
        },
        {
          stateId: '4',
          name: 'Crisis',
          instruction: 'Crisis',
          dialogues: ['Help me.'],
        },
      ]);
    });

    it('should throw when OPENING_STATEMENTS response is not valid JSON', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse('not json'));

      await expect(
        service.generateFieldContent(
          GeneratableField.OPENING_STATEMENTS,
          'CODE',
          scenarioContext,
        ),
      ).rejects.toThrow();
    });

    it('should throw when STATE_INSTRUCTIONS response is not valid JSON', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse('invalid'));

      await expect(
        service.generateFieldContent(
          GeneratableField.STATE_INSTRUCTIONS,
          'CODE',
          scenarioContext,
        ),
      ).rejects.toThrow();
    });
  });

  describe('JSON schema suffix (structured fields)', () => {
    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('base prompt');
    });

    it('should append JSON schema instruction to prompt for OPENING_STATEMENTS', async () => {
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify({ statements: ['hi'] })),
      );

      await service.generateFieldContent(
        GeneratableField.OPENING_STATEMENTS,
        'CODE',
        scenarioContext,
      );

      const sentPrompt = mockCreate.mock.calls[0][0].messages[0]
        .content as string;
      expect(sentPrompt).toContain('base prompt');
      expect(sentPrompt).toContain('Respond with valid JSON only');
      expect(sentPrompt).toContain('"statements"');
    });

    it('should NOT append JSON schema suffix for DESCRIPTION', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse('plain text'));

      await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
      );

      const sentPrompt = mockCreate.mock.calls[0][0].messages[0]
        .content as string;
      expect(sentPrompt).toBe('base prompt');
    });

    it('should NOT append JSON schema suffix for CHARACTER_PROFILE_TEXT', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse('profile text'));

      await service.generateFieldContent(
        GeneratableField.CHARACTER_PROFILE_TEXT,
        'CODE',
        scenarioContext,
      );

      const sentPrompt = mockCreate.mock.calls[0][0].messages[0]
        .content as string;
      expect(sentPrompt).toBe('base prompt');
    });
  });

  describe('renderTemplate (via generateFieldContent)', () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue(makeAnthropicResponse('ok'));
    });

    it('should substitute template variables into the prompt', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        'Name: {{ name }}, Title: {{ title }}',
      );

      await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
      );

      const sentMessage = mockCreate.mock.calls[0][0].messages[0].content;
      expect(sentMessage).toBe('Name: John, Title: Anxiety Counseling');
    });

    it('should replace missing variables with empty string', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        'Name: {{ name }}, Profession: {{ profession }}',
      );

      await service.generateFieldContent(GeneratableField.DESCRIPTION, 'CODE', {
        title: 'Test',
        name: 'Jane',
      });

      const sentMessage = mockCreate.mock.calls[0][0].messages[0].content;
      expect(sentMessage).toBe('Name: Jane, Profession: ');
    });
  });

  describe('extractContent - BEHAVIOR_INSTRUCTIONS', () => {
    const mapping = new Map();
    mapping.set(1, { id: 'uuid-aaa', name: 'Active Listening' });
    mapping.set(2, { id: 'uuid-bbb', name: 'Reflective Responding' });
    mapping.set(3, { id: 'uuid-ccc', name: 'Open-ended Questioning' });

    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('template');
    });

    it('should parse behavior instructions and map sequential IDs to UUIDs', async () => {
      const rawResponse = {
        instructions: [
          {
            category: 'SHOULD_DO',
            helper_behavior_ids: [1, 3],
            actor_response: 'I feel like you truly understand.',
            stateInstructions: mockBehaviorStateInstructions,
          },
          {
            category: 'SHOULD_NOT_DO',
            helper_behavior_ids: [2],
            actor_response: 'I feel dismissed.',
            stateInstructions: mockBehaviorStateInstructions,
          },
        ],
        state_names: [
          { stateId: '-1', name: 'Calm' },
          { stateId: '1', name: 'Worried' },
          { stateId: '2', name: 'Escalated' },
          { stateId: '3', name: 'Crisis' },
        ],
      };
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify(rawResponse)),
      );

      const result = (await service.generateFieldContent(
        GeneratableField.BEHAVIOR_INSTRUCTIONS,
        'CODE',
        scenarioContext,
        mapping,
      )) as any;

      expect(result.instructions).toEqual([
        {
          category: BehaviorInstructionCategory.SHOULD_DO,
          behaviors: [
            { id: 'uuid-aaa', name: 'Active Listening' },
            { id: 'uuid-ccc', name: 'Open-ended Questioning' },
          ],
          stateInstructions: mockBehaviorStateInstructions,
        },
        {
          category: BehaviorInstructionCategory.SHOULD_NOT_DO,
          behaviors: [{ id: 'uuid-bbb', name: 'Reflective Responding' }],
          stateInstructions: mockBehaviorStateInstructions,
        },
      ]);
      expect(result.stateNames).toEqual([
        { stateId: '-1', name: 'Calm' },
        { stateId: '1', name: 'Worried' },
        { stateId: '2', name: 'Escalated' },
        { stateId: '3', name: 'Crisis' },
      ]);
    });

    it('should filter out invalid sequential IDs not in the mapping', async () => {
      const rawResponse = {
        instructions: [
          {
            category: 'SHOULD_DO',
            helper_behavior_ids: [1, 999],
            actor_response: 'I feel supported.',
            stateInstructions: mockBehaviorStateInstructions,
          },
        ],
        state_names: [{ stateId: '-1', name: 'Calm' }],
      };
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify(rawResponse)),
      );

      const result = (await service.generateFieldContent(
        GeneratableField.BEHAVIOR_INSTRUCTIONS,
        'CODE',
        scenarioContext,
        mapping,
      )) as any;

      expect(result.instructions[0].behaviors).toEqual([
        { id: 'uuid-aaa', name: 'Active Listening' },
      ]);
    });

    it('should throw when BEHAVIOR_INSTRUCTIONS response is not valid JSON', async () => {
      mockCreate.mockResolvedValue(makeAnthropicResponse('not json'));

      await expect(
        service.generateFieldContent(
          GeneratableField.BEHAVIOR_INSTRUCTIONS,
          'CODE',
          scenarioContext,
          mapping,
        ),
      ).rejects.toThrow();
    });
  });

  describe('extractContent - LINGUISTIC_STYLE_SAMPLES', () => {
    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('template');
    });

    it('should parse and return samples array', async () => {
      const samples = ['sample one', 'sample two', 'sample three'];
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify({ samples })),
      );

      const result = await service.generateFieldContent(
        GeneratableField.LINGUISTIC_STYLE_SAMPLES,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual(samples);
    });

    it('should return empty array when samples is missing', async () => {
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify({ other: 'data' })),
      );

      const result = await service.generateFieldContent(
        GeneratableField.LINGUISTIC_STYLE_SAMPLES,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual([]);
    });

    it('should filter out empty strings from samples', async () => {
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(
          JSON.stringify({ samples: ['valid', '', '  ', 'also valid'] }),
        ),
      );

      const result = await service.generateFieldContent(
        GeneratableField.LINGUISTIC_STYLE_SAMPLES,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual(['valid', 'also valid']);
    });
  });

  describe('extractContent - ALLOWED_FILLER_WORDS', () => {
    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('template');
    });

    it('should parse and return fillers array', async () => {
      const fillers = ['um', 'uh', 'like'];
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify({ fillers })),
      );

      const result = await service.generateFieldContent(
        GeneratableField.ALLOWED_FILLER_WORDS,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual(fillers);
    });

    it('should return empty array when fillers is missing', async () => {
      mockCreate.mockResolvedValue(
        makeAnthropicResponse(JSON.stringify({ other: 'data' })),
      );

      const result = await service.generateFieldContent(
        GeneratableField.ALLOWED_FILLER_WORDS,
        'CODE',
        scenarioContext,
      );

      expect(result).toEqual([]);
    });
  });
});
