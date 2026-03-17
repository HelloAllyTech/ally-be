import { Test, TestingModule } from '@nestjs/testing';
import { CanActivate } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PromptsController } from '../prompts.controller';
import { PromptsService } from '../../service/prompt.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AiApiKeyGuard } from 'src/auth/guards/ai-auth.guard';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { CreatePromptsDto } from '../../dto/create-prompts.dto';
import { UpdatePromptDto } from '../../dto/update-prompt.dto';
import { SortOrder } from 'src/user/enum/user.enum';
import { PromptResponse } from '../../type/prompt-response.type';
import { SyncPromptsDto } from '../../dto/sync-prompts.dto';

// Mock guard that allows all requests
class MockGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('PromptsController', () => {
  let controller: PromptsController;
  let service: PromptsService;

  const mockPromptResponse: PromptResponse = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    createdAt: new Date('2026-02-09'),
    prompt: 'This is the prompt content for AI learning',
  };

  const mockPrompt = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    currentVersion: 1,
    useDashboardOverride: false,
    isObsolete: false,
    createdAt: new Date('2026-02-09'),
    updatedAt: new Date('2026-02-09'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PromptsController],
      providers: [
        {
          provide: PromptsService,
          useValue: {
            getPrompts: jest.fn(),
            createPrompts: jest.fn(),
            updatePrompt: jest.fn(),
            getPromptsByCodes: jest.fn(),
            syncPrompts: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useClass(MockGuard)
      .overrideGuard(PermissionsGuard)
      .useClass(MockGuard)
      .overrideGuard(AiApiKeyGuard)
      .useClass(MockGuard)
      .overrideGuard(ApiAuthGuard)
      .useClass(MockGuard)
      .compile();

    controller = module.get<PromptsController>(PromptsController);
    service = module.get<PromptsService>(PromptsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPrompts', () => {
    it('should return an array of prompts', async () => {
      const mockPrompts: PromptResponse[] = [
        mockPromptResponse,
        {
          ...mockPromptResponse,
          id: '223e4567-e89b-12d3-a456-426614174001',
          promptCode: 'ally_learn_prompt',
          name: 'Learn Prompt',
        },
      ];

      jest.spyOn(service, 'getPrompts').mockResolvedValue(mockPrompts);

      const result = await controller.getPrompts(
        10,
        0,
        'createdAt',
        SortOrder.DESC,
        'prompt',
      );

      expect(result).toEqual(mockPrompts);
      expect(service.getPrompts).toHaveBeenCalledWith('prompt', {
        limit: 10,
        offset: 0,
        sortBy: 'createdAt',
        order: SortOrder.DESC,
      });
      expect(service.getPrompts).toHaveBeenCalledTimes(1);
    });

    it('should return empty array when no prompts exist', async () => {
      jest.spyOn(service, 'getPrompts').mockResolvedValue([]);

      const result = await controller.getPrompts();

      expect(result).toEqual([]);
      expect(service.getPrompts).toHaveBeenCalledWith(undefined, {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: SortOrder.ASC,
      });
    });

    it('should handle pagination parameters', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];
      jest.spyOn(service, 'getPrompts').mockResolvedValue(mockPrompts);

      await controller.getPrompts(20, 40, 'name', SortOrder.ASC);

      expect(service.getPrompts).toHaveBeenCalledWith(undefined, {
        limit: 20,
        offset: 40,
        sortBy: 'name',
        order: SortOrder.ASC,
      });
    });

    it('should handle search name parameter', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];
      jest.spyOn(service, 'getPrompts').mockResolvedValue(mockPrompts);

      await controller.getPrompts(
        undefined,
        undefined,
        undefined,
        SortOrder.ASC,
        'AI',
      );

      expect(service.getPrompts).toHaveBeenCalledWith('AI', {
        limit: undefined,
        offset: undefined,
        sortBy: undefined,
        order: SortOrder.ASC,
      });
    });

    it('should use default sort order ASC when not provided', async () => {
      jest.spyOn(service, 'getPrompts').mockResolvedValue([]);

      await controller.getPrompts();

      expect(service.getPrompts).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          order: SortOrder.ASC,
        }),
      );
    });
  });

  describe('getPromptsByCodes', () => {
    it('should return prompts by codes', async () => {
      const codes = 'code1,code2';
      const mockResult = { code1: 'prompt1', code2: 'prompt2' };
      jest.spyOn(service, 'getPromptsByCodes').mockResolvedValue(mockResult);

      const result = await controller.getPromptsByCodes(codes);

      expect(result).toEqual(mockResult);
      expect(service.getPromptsByCodes).toHaveBeenCalledWith([
        'code1',
        'code2',
      ]);
    });

    it('should return empty object if no codes provided', async () => {
      const result = await controller.getPromptsByCodes('');
      expect(result).toEqual({});
      expect(service.getPromptsByCodes).not.toHaveBeenCalled();
    });

    it('should handle whitespace and empty entries in codes', async () => {
      const codes = ' code1 , , code2 ';
      const mockResult = { code1: 'prompt1', code2: 'prompt2' };
      jest.spyOn(service, 'getPromptsByCodes').mockResolvedValue(mockResult);

      const result = await controller.getPromptsByCodes(codes);

      expect(result).toEqual(mockResult);
      expect(service.getPromptsByCodes).toHaveBeenCalledWith([
        'code1',
        'code2',
      ]);
    });
  });

  describe('createPrompts', () => {
    it('should create new prompts successfully', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'AI Learn',
            name: 'AI Learning Prompt',
            description: 'A prompt for AI learning',
            prompt: 'This is the prompt content for AI learning',
          },
        ],
      };

      const mockCreatedPrompts = [mockPrompt];

      jest
        .spyOn(service, 'createPrompts')
        .mockResolvedValue(mockCreatedPrompts);

      const result = await controller.createPrompts(createPromptsDto);

      expect(result).toEqual(mockCreatedPrompts);
      expect(service.createPrompts).toHaveBeenCalledWith(createPromptsDto);
      expect(service.createPrompts).toHaveBeenCalledTimes(1);
    });

    it('should create multiple prompts in bulk', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'AI Learn',
            name: 'AI Learning Prompt',
            description: 'A prompt for AI learning',
            prompt: 'Content 1',
          },
          {
            promptCode: 'Learn Path',
            name: 'Learning Path Prompt',
            description: 'A prompt for learning path',
            prompt: 'Content 2',
          },
        ],
      };

      const mockCreatedPrompts = [
        mockPrompt,
        {
          ...mockPrompt,
          id: '223e4567-e89b-12d3-a456-426614174001',
          promptCode: 'ally_learn_path',
          name: 'Learning Path Prompt',
          isObsolete: false,
        },
      ];

      jest
        .spyOn(service, 'createPrompts')
        .mockResolvedValue(mockCreatedPrompts);

      const result = await controller.createPrompts(createPromptsDto);

      expect(result).toHaveLength(2);
      expect(service.createPrompts).toHaveBeenCalledWith(createPromptsDto);
    });

    it('should create prompt without description (optional field)', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'Quick Prompt',
            name: 'Quick Prompt',
            prompt: 'Quick prompt content',
          },
        ],
      };

      jest.spyOn(service, 'createPrompts').mockResolvedValue([mockPrompt]);

      const result = await controller.createPrompts(createPromptsDto);

      expect(result).toBeDefined();
      expect(service.createPrompts).toHaveBeenCalledWith(createPromptsDto);
    });

    it('should handle prompt code standardization', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'My AI Learn Prompt',
            name: 'My AI Learning',
            description: 'Test',
            prompt: 'Content',
          },
        ],
      };

      // Service should standardize: "My AI Learn Prompt" -> "ally_my_ai_learn_prompt"
      jest.spyOn(service, 'createPrompts').mockResolvedValue([
        {
          ...mockPrompt,
          promptCode: 'ally_my_ai_learn_prompt',
        },
      ]);

      const result = await controller.createPrompts(createPromptsDto);

      expect(result[0].promptCode).toBe('ally_my_ai_learn_prompt');
    });
  });

  describe('updatePrompt', () => {
    const promptId = '123e4567-e89b-12d3-a456-426614174000';

    it('should update prompt successfully', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'Updated Prompt Name',
        description: 'Updated description',
        prompt: 'Updated prompt content',
      };

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(true);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(true);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
      expect(service.updatePrompt).toHaveBeenCalledTimes(1);
    });

    it('should update only name', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'New Name',
      };

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(true);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(true);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
    });

    it('should update only description', async () => {
      const updatePromptDto: UpdatePromptDto = {
        description: 'New Description',
      };

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(true);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(true);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
    });

    it('should create new version when prompt content is updated', async () => {
      const updatePromptDto: UpdatePromptDto = {
        prompt: 'New prompt content',
      };

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(true);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(true);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
    });

    it('should update promptCode with standardization', async () => {
      const updatePromptDto: UpdatePromptDto = {
        promptCode: 'New Prompt Code',
      };

      // Service should standardize: "New Prompt Code" -> "ally_new_prompt_code"
      jest.spyOn(service, 'updatePrompt').mockResolvedValue(true);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(true);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
    });

    it('should update multiple fields at once', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'New Name',
        description: 'New Description',
        promptCode: 'New Code',
        prompt: 'New Content',
      };

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(true);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(true);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
    });

    it('should return false when prompt update fails', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'Updated Name',
      };

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(false);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(false);
    });

    it('should handle empty update object', async () => {
      const updatePromptDto: UpdatePromptDto = {};

      jest.spyOn(service, 'updatePrompt').mockResolvedValue(false);

      const result = await controller.updatePrompt(promptId, updatePromptDto);

      expect(result).toBe(false);
      expect(service.updatePrompt).toHaveBeenCalledWith(
        promptId,
        updatePromptDto,
      );
    });
  });

  describe('syncPrompts', () => {
    it('should sync prompts successfully', async () => {
      const syncPromptsDto: SyncPromptsDto = {
        prompts: [
          {
            promptCode: 'test-code',
            name: 'test-name',
            description: 'test-desc',
            prompt: 'test-prompt',
          },
        ],
      };
      const mockSyncResult = { added: 1, updated: 0 };
      jest.spyOn(service, 'syncPrompts').mockResolvedValue(mockSyncResult);

      const result = await controller.syncPrompts(syncPromptsDto);

      expect(result).toEqual(mockSyncResult);
      expect(service.syncPrompts).toHaveBeenCalledWith(syncPromptsDto);
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors in getPrompts', async () => {
      jest
        .spyOn(service, 'getPrompts')
        .mockRejectedValue(new Error('Database error'));

      await expect(controller.getPrompts()).rejects.toThrow('Database error');
    });

    it('should handle service errors in createPrompts', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'Test',
            name: 'Test',
            prompt: 'Test',
          },
        ],
      };

      jest
        .spyOn(service, 'createPrompts')
        .mockRejectedValue(new Error('Creation failed'));

      await expect(controller.createPrompts(createPromptsDto)).rejects.toThrow(
        'Creation failed',
      );
    });

    it('should handle service errors in updatePrompt', async () => {
      const updatePromptDto: UpdatePromptDto = { name: 'Test' };

      jest
        .spyOn(service, 'updatePrompt')
        .mockRejectedValue(new Error('Update failed'));

      await expect(
        controller.updatePrompt('invalid-id', updatePromptDto),
      ).rejects.toThrow('Update failed');
    });
  });
});
