import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { OpenAIAutofillService } from '../openai-autofil-service';
import { AppConfigService } from 'src/config/config.service';
import { PromptSharedService } from 'src/prompt/service/prompt-shared.service';
import { GeneratableField } from 'src/learn/enum/generatable-field.enum';
import { STRUCTURED_OUTPUT_SCHEMAS } from 'src/learn/constants/autofill-structured-output.constants';
import { BehaviorInstructionCategory } from 'src/learn/enum/behavior-instruction.enum';

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

  const scenarioContext = {
    title: 'Anxiety Counseling',
    name: 'John',
    age: 30,
    gender: 'Male',
  };

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
      ],
    }).compile();

    service = module.get(OpenAIAutofillService);
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

    it('should throw InternalServerErrorException when OpenAI returns empty content', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        'Generate: {{ title }}',
      );
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '' } }],
      });

      await expect(
        service.generateFieldContent(
          GeneratableField.DESCRIPTION,
          'PROMPT_CODE',
          scenarioContext,
        ),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('should re-throw errors from OpenAI client', async () => {
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
  });

  describe('extractContent', () => {
    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('template');
    });

    it('should return raw string for CHARACTER_PROFILE_TEXT', async () => {
      const raw = 'John is a 30-year-old male...';
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: raw } }],
      });

      const result = await service.generateFieldContent(
        GeneratableField.CHARACTER_PROFILE_TEXT,
        'CODE',
        scenarioContext,
      );

      expect(result).toBe(raw);
    });

    it('should return raw string for DESCRIPTION', async () => {
      const raw = 'This scenario focuses on anxiety...';
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: raw } }],
      });

      const result = await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
      );

      expect(result).toBe(raw);
    });

    it('should parse and return statements array for OPENING_STATEMENTS', async () => {
      const statements = ['Hello there.', 'I need help.'];
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ statements }) } }],
      });

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
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(rawResponse) } }],
      });

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
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
      });

      await expect(
        service.generateFieldContent(
          GeneratableField.OPENING_STATEMENTS,
          'CODE',
          scenarioContext,
        ),
      ).rejects.toThrow();
    });

    it('should throw when STATE_INSTRUCTIONS response is not valid JSON', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'invalid' } }],
      });

      await expect(
        service.generateFieldContent(
          GeneratableField.STATE_INSTRUCTIONS,
          'CODE',
          scenarioContext,
        ),
      ).rejects.toThrow();
    });
  });

  describe('renderTemplate', () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
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

  describe('buildTemplateVariables', () => {
    beforeEach(() => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
    });

    it('should convert numeric values to strings', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue('Age: {{ age }}');

      await service.generateFieldContent(GeneratableField.DESCRIPTION, 'CODE', {
        title: 'Test',
        age: 25,
      });

      const sentMessage = mockCreate.mock.calls[0][0].messages[0].content;
      expect(sentMessage).toBe('Age: 25');
    });

    it('should convert null values to empty string', async () => {
      promptSharedService.getPromptByCode.mockResolvedValue(
        'Gender: {{ gender }}',
      );

      await service.generateFieldContent(GeneratableField.DESCRIPTION, 'CODE', {
        title: 'Test',
        gender: null,
      } as any);

      const sentMessage = mockCreate.mock.calls[0][0].messages[0].content;
      expect(sentMessage).toBe('Gender: ');
    });
  });

  describe('OpenAI call configuration', () => {
    beforeEach(() => {
      promptSharedService.getPromptByCode.mockResolvedValue('prompt');
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' } }],
      });
    });

    it('should not include response_format for DESCRIPTION (no schema)', async () => {
      await service.generateFieldContent(
        GeneratableField.DESCRIPTION,
        'CODE',
        scenarioContext,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.not.objectContaining({ response_format: expect.anything() }),
      );
    });

    it('should not include response_format for CHARACTER_PROFILE_TEXT (no schema)', async () => {
      await service.generateFieldContent(
        GeneratableField.CHARACTER_PROFILE_TEXT,
        'CODE',
        scenarioContext,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.not.objectContaining({ response_format: expect.anything() }),
      );
    });

    it('should include json_schema response_format for OPENING_STATEMENTS', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          { message: { content: JSON.stringify({ statements: ['hi'] }) } },
        ],
      });

      await service.generateFieldContent(
        GeneratableField.OPENING_STATEMENTS,
        'CODE',
        scenarioContext,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: {
            type: 'json_schema',
            json_schema:
              STRUCTURED_OUTPUT_SCHEMAS[GeneratableField.OPENING_STATEMENTS],
          },
        }),
      );
    });

    it('should include json_schema response_format for STATE_INSTRUCTIONS', async () => {
      const stateInstructions = {
        state_1: { name: 'Calm', instruction: 'a', dialogues: ['b'] },
        state_2: { name: 'Worried', instruction: 'c', dialogues: ['d'] },
        state_3: { name: 'Escalated', instruction: 'e', dialogues: ['f'] },
        state_4: { name: 'Crisis', instruction: 'g', dialogues: ['h'] },
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(stateInstructions) } }],
      });

      await service.generateFieldContent(
        GeneratableField.STATE_INSTRUCTIONS,
        'CODE',
        scenarioContext,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: {
            type: 'json_schema',
            json_schema:
              STRUCTURED_OUTPUT_SCHEMAS[GeneratableField.STATE_INSTRUCTIONS],
          },
        }),
      );
    });

    it('should include json_schema response_format for BEHAVIOR_INSTRUCTIONS', async () => {
      const behaviorResponse = {
        instructions: [
          {
            category: 'SHOULD_DO',
            helper_behavior_ids: [1],
            actor_response: 'I feel heard and understood right now.',
          },
        ],
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(behaviorResponse) } }],
      });

      const mapping = new Map();
      mapping.set(1, { id: 'uuid-1', name: 'Active Listening' });

      await service.generateFieldContent(
        GeneratableField.BEHAVIOR_INSTRUCTIONS,
        'CODE',
        scenarioContext,
        mapping,
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: {
            type: 'json_schema',
            json_schema:
              STRUCTURED_OUTPUT_SCHEMAS[GeneratableField.BEHAVIOR_INSTRUCTIONS],
          },
        }),
      );
    });
  });

  describe('buildBehaviorIdMapping', () => {
    it('should build sequential ID mapping and formatted list', () => {
      const behaviors = [
        { id: 'uuid-aaa', name: 'Active Listening' },
        { id: 'uuid-bbb', name: 'Reflective Responding' },
        { id: 'uuid-ccc', name: 'Open-ended Questioning' },
      ];

      const { mapping, formattedList } =
        service.buildBehaviorIdMapping(behaviors);

      expect(mapping.get(1)).toEqual({
        id: 'uuid-aaa',
        name: 'Active Listening',
      });
      expect(mapping.get(2)).toEqual({
        id: 'uuid-bbb',
        name: 'Reflective Responding',
      });
      expect(mapping.get(3)).toEqual({
        id: 'uuid-ccc',
        name: 'Open-ended Questioning',
      });
      expect(formattedList).toBe(
        '1. Active Listening\n2. Reflective Responding\n3. Open-ended Questioning',
      );
    });

    it('should return empty mapping and list for empty behaviors', () => {
      const { mapping, formattedList } = service.buildBehaviorIdMapping([]);

      expect(mapping.size).toBe(0);
      expect(formattedList).toBe('');
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
            actor_response:
              'I feel like you truly understand what I am going through.',
          },
          {
            category: 'SHOULD_NOT_DO',
            helper_behavior_ids: [2],
            actor_response:
              'I feel dismissed and unheard when you respond that way.',
          },
        ],
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(rawResponse) } }],
      });

      const result = await service.generateFieldContent(
        GeneratableField.BEHAVIOR_INSTRUCTIONS,
        'CODE',
        scenarioContext,
        mapping,
      );

      expect(result).toEqual([
        {
          category: BehaviorInstructionCategory.SHOULD_DO,
          behaviors: [
            { id: 'uuid-aaa', name: 'Active Listening' },
            { id: 'uuid-ccc', name: 'Open-ended Questioning' },
          ],
          instructions: [
            'I feel like you truly understand what I am going through.',
          ],
        },
        {
          category: BehaviorInstructionCategory.SHOULD_NOT_DO,
          behaviors: [{ id: 'uuid-bbb', name: 'Reflective Responding' }],
          instructions: [
            'I feel dismissed and unheard when you respond that way.',
          ],
        },
      ]);
    });

    it('should filter out invalid sequential IDs that are not in the mapping', async () => {
      const rawResponse = {
        instructions: [
          {
            category: 'SHOULD_DO',
            helper_behavior_ids: [1, 999],
            actor_response: 'I feel supported by your approach.',
          },
        ],
      };
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(rawResponse) } }],
      });

      const result = await service.generateFieldContent(
        GeneratableField.BEHAVIOR_INSTRUCTIONS,
        'CODE',
        scenarioContext,
        mapping,
      );

      expect(result).toEqual([
        {
          category: BehaviorInstructionCategory.SHOULD_DO,
          behaviors: [{ id: 'uuid-aaa', name: 'Active Listening' }],
          instructions: ['I feel supported by your approach.'],
        },
      ]);
    });

    it('should throw when BEHAVIOR_INSTRUCTIONS response is not valid JSON', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
      });

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
});
