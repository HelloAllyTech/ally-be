import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PromptsService } from '../prompt.service';
import { PromptsRepository } from '../../repository/prompt.repository';
import { PromptVersionRepository } from '../../repository/prompt-version.repository';
import { PromptSharedService } from '../prompt-shared.service';
import { PromptTranslationService } from '../prompt-translation.service';
import { CreatePromptsDto } from '../../dto/create-prompts.dto';
import { UpdatePromptDto } from '../../dto/update-prompt.dto';
import { Prompt } from '../../entity/prompt.entity';
import { PromptVersion } from '../../entity/prompt-version.entity';
import { PromptResponse } from '../../type/prompt-response.type';

// Mock ExecutionManager
jest.mock('src/common/execution/execution-manager', () => ({
  ExecutionManager: {
    getUserId: jest.fn(),
    getExecutionId: jest.fn(),
  },
}));

import { ExecutionManager } from 'src/common/execution/execution-manager';
import { DataSource } from 'typeorm';

describe('PromptsService', () => {
  let service: PromptsService;
  let promptsRepository: PromptsRepository;
  let promptVersionRepository: PromptVersionRepository;
  let translatePrompt: jest.Mock;
  /** Raw-SQL escape hatch used by the scenario-usage queries. */
  let dataSourceQuery: jest.Mock;

  const mockUserId = '123';
  const mockPromptId = '123e4567-e89b-12d3-a456-426614174000';
  const mockVersionId = '223e4567-e89b-12d3-a456-426614174001';

  const mockPrompt: Prompt = {
    id: mockPromptId,
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    currentVersion: 1,
    useDashboardOverride: false,
    isObsolete: false,
    createdAt: new Date('2026-02-09'),
    updatedAt: new Date('2026-02-09'),
  };

  const mockPromptVersion: PromptVersion = {
    id: mockVersionId,
    promptId: mockPromptId,
    version: 1,
    prompt: 'This is the prompt content',
    createdBy: 123,
    updatedBy: 123,
    createdAt: new Date('2026-02-09'),
    updatedAt: new Date('2026-02-09'),
  };

  const mockPromptResponse: PromptResponse = {
    id: mockPromptId,
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    createdAt: new Date('2026-02-09'),
    prompt: 'This is the prompt content',
  };

  beforeEach(async () => {
    // Mock ExecutionManager.getUserId()
    (ExecutionManager.getUserId as jest.Mock).mockReturnValue(mockUserId);

    const mockDataSource = {
      transaction: jest.fn().mockImplementation(async (cb: any) => await cb()),
      query: (dataSourceQuery = jest.fn().mockResolvedValue([{ count: '0' }])),
    } as unknown as DataSource;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptsService,
        {
          provide: PromptsRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            getPrompts: jest.fn(),
            getPromptById: jest.fn(),
          },
        },
        {
          provide: PromptVersionRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            delete: jest.fn(),
            getLatestPromptVersion: jest.fn(),
            deleteVersionsBefore: jest.fn(),
          },
        },
        {
          provide: PromptSharedService,
          useValue: {
            getPromptByCode: jest.fn(),
            getPromptsByOptions: jest.fn(),
          },
        },
        {
          provide: PromptTranslationService,
          useValue: {
            translatePrompt: (translatePrompt = jest
              .fn()
              .mockResolvedValue({ eligible: true, translated: 4 })),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    })
      .overrideProvider(DataSource)
      .useValue(mockDataSource)
      .compile();

    service = module.get<PromptsService>(PromptsService);
    promptsRepository = module.get<PromptsRepository>(PromptsRepository);
    promptVersionRepository = module.get<PromptVersionRepository>(
      PromptVersionRepository,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createPrompts', () => {
    it('should create single prompt with initial version', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'AI Learn',
            name: 'AI Learning Prompt',
            description: 'A prompt for AI learning',
            prompt: 'This is the prompt content',
          },
        ],
      };

      const createdPrompt = { ...mockPrompt, id: mockPromptId };
      (promptsRepository.create as jest.Mock).mockReturnValue(createdPrompt);
      (promptsRepository.save as jest.Mock)
        .mockResolvedValueOnce([createdPrompt])
        .mockResolvedValueOnce([createdPrompt]);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue([
        mockPromptVersion,
      ]);

      const result = await service.createPrompts(createPromptsDto);

      expect(result).toEqual([createdPrompt]);
      expect(promptsRepository.create).toHaveBeenCalled();
      expect(promptsRepository.save).toHaveBeenCalledTimes(2);
      expect(promptVersionRepository.save).toHaveBeenCalled();
    });

    it('should create multiple prompts with initial versions', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'AI Learn',
            name: 'AI Learning',
            description: 'AI Learning Prompt',
            prompt: 'Content 1',
          },
          {
            promptCode: 'Learn Path',
            name: 'Learning Path',
            description: 'Learning Path Prompt',
            prompt: 'Content 2',
          },
        ],
      };

      const prompt1 = { ...mockPrompt, id: mockPromptId };
      const prompt2 = {
        ...mockPrompt,
        id: '323e4567-e89b-12d3-a456-426614174002',
        promptCode: 'ally_learn_path',
        name: 'Learning Path',
        isObsolete: false,
      };

      (promptsRepository.create as jest.Mock)
        .mockReturnValueOnce(prompt1)
        .mockReturnValueOnce(prompt2);
      (promptsRepository.save as jest.Mock)
        .mockResolvedValueOnce([prompt1, prompt2])
        .mockResolvedValueOnce([prompt1, prompt2]);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue([
        mockPromptVersion,
        mockPromptVersion,
      ]);

      const result = await service.createPrompts(createPromptsDto);

      expect(result).toHaveLength(2);
      expect(promptsRepository.create).toHaveBeenCalledTimes(2);
      expect(promptVersionRepository.save).toHaveBeenCalled();
    });

    it('should standardize prompt code during creation', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'My AI Learn',
            name: 'Test',
            prompt: 'Content',
          },
        ],
      };

      const createdPrompt = {
        ...mockPrompt,
        promptCode: 'my_ai_learn',
      };
      (promptsRepository.create as jest.Mock).mockReturnValue(createdPrompt);
      (promptsRepository.save as jest.Mock)
        .mockResolvedValueOnce([createdPrompt])
        .mockResolvedValueOnce([createdPrompt]);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue([
        mockPromptVersion,
      ]);

      await service.createPrompts(createPromptsDto);

      expect(promptsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          promptCode: expect.stringMatching(/^my_ai_learn/),
        }),
      );
    });

    it('should set currentVersion to 1 for new prompts', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'Test',
            name: 'Test',
            prompt: 'Content',
          },
        ],
      };

      const createdPrompt = mockPrompt;
      (promptsRepository.create as jest.Mock).mockReturnValue(createdPrompt);
      (promptsRepository.save as jest.Mock)
        .mockResolvedValueOnce([createdPrompt])
        .mockResolvedValueOnce([createdPrompt]);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue([
        mockPromptVersion,
      ]);

      await service.createPrompts(createPromptsDto);

      // Check that update was called with currentVersion: 1
      const updateCall = (promptsRepository.save as jest.Mock).mock.calls[1];
      expect(updateCall[0][0]).toHaveProperty('currentVersion', 1);
    });

    it('should use ExecutionManager to get userId', async () => {
      const createPromptsDto: CreatePromptsDto = {
        prompts: [
          {
            promptCode: 'Test',
            name: 'Test',
            prompt: 'Content',
          },
        ],
      };

      const createdPrompt = mockPrompt;
      (promptsRepository.create as jest.Mock).mockReturnValue(createdPrompt);
      (promptsRepository.save as jest.Mock)
        .mockResolvedValueOnce([createdPrompt])
        .mockResolvedValueOnce([createdPrompt]);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue([
        mockPromptVersion,
      ]);

      await service.createPrompts(createPromptsDto);

      expect(ExecutionManager.getUserId).toHaveBeenCalled();
    });
  });

  describe('updatePrompt', () => {
    it('should update prompt successfully', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'Updated Name',
        description: 'Updated Description',
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      const result = await service.updatePrompt(mockPromptId, updatePromptDto);

      expect(result).toBe(true);
      expect(promptsRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockPromptId },
      });
      expect(promptsRepository.update).toHaveBeenCalled();
    });

    it('should throw NotFoundException when prompt not found', async () => {
      const updatePromptDto: UpdatePromptDto = { name: 'Test' };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updatePrompt('invalid-id', updatePromptDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('should only update changed fields', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'Updated Name',
        description: 'Updated Description',
      };

      const currentPrompt = {
        ...mockPrompt,
        name: 'Different Name', // different from update
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(currentPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, updatePromptDto);

      // Should include name in update since it changed
      const updateCall = (promptsRepository.update as jest.Mock).mock.calls[0];
      expect(updateCall[1]).toHaveProperty('name');
    });

    it('should standardize promptCode when updating', async () => {
      const updatePromptDto: UpdatePromptDto = {
        promptCode: 'New Code',
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, updatePromptDto);

      const updateCall = (promptsRepository.update as jest.Mock).mock.calls[0];
      // Verify promptCode was included in the update
      expect(updateCall[1]).toHaveProperty('promptCode');
    });

    it('should return false when update affects 0 rows', async () => {
      const updatePromptDto: UpdatePromptDto = { name: 'Test' };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 0,
      });

      const result = await service.updatePrompt(mockPromptId, updatePromptDto);

      expect(result).toBe(false);
    });

    it('should create new version when prompt content changes', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'Updated Name',
        prompt: 'New prompt content',
        useDashboardOverride: true,
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (
        promptVersionRepository.getLatestPromptVersion as jest.Mock
      ).mockResolvedValue(mockPromptVersion);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );

      await service.updatePrompt(mockPromptId, updatePromptDto);

      expect(promptVersionRepository.create).toHaveBeenCalled();
      expect(promptVersionRepository.save).toHaveBeenCalled();
    });

    it('should increment version number correctly', async () => {
      const updatePromptDto: UpdatePromptDto = {
        name: 'Updated Name',
        prompt: 'New prompt content',
        useDashboardOverride: true,
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      const latestVersion = { ...mockPromptVersion, version: 2 };
      (
        promptVersionRepository.getLatestPromptVersion as jest.Mock
      ).mockResolvedValue(latestVersion);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );

      await service.updatePrompt(mockPromptId, updatePromptDto);

      const versionCall = (promptVersionRepository.create as jest.Mock).mock
        .calls[0][0];
      expect(versionCall.version).toBe(3); // 2 + 1
    });

    it('should not create new version if only updating description without prompt content', async () => {
      const updatePromptDto: UpdatePromptDto = {
        description: 'Updated description',
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, updatePromptDto);

      expect(promptVersionRepository.create).not.toHaveBeenCalled();
    });

    it('should create new version even if only one word changes in prompt content', async () => {
      const updatePromptDto: UpdatePromptDto = {
        prompt: 'This is the updated prompt content',
        useDashboardOverride: true,
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (
        promptVersionRepository.getLatestPromptVersion as jest.Mock
      ).mockResolvedValue(mockPromptVersion);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (
        promptVersionRepository.deleteVersionsBefore as jest.Mock
      ).mockResolvedValue(undefined);

      await service.updatePrompt(mockPromptId, updatePromptDto);

      expect(promptVersionRepository.create).toHaveBeenCalled();
      expect(promptVersionRepository.save).toHaveBeenCalled();
    });

    it('should apply version retention limit when creating new version', async () => {
      const updatePromptDto: UpdatePromptDto = {
        prompt: 'New prompt content',
        useDashboardOverride: true,
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (
        promptVersionRepository.getLatestPromptVersion as jest.Mock
      ).mockResolvedValue({ ...mockPromptVersion, version: 5 });
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (
        promptVersionRepository.deleteVersionsBefore as jest.Mock
      ).mockResolvedValue(undefined);

      await service.updatePrompt(mockPromptId, updatePromptDto);

      // With retention limit of 5, if latest version is 5 and we create 6,
      // we should keep versions >= (6 - (5 - 1)) = 2
      expect(promptVersionRepository.deleteVersionsBefore).toHaveBeenCalledWith(
        mockPromptId,
        2,
      );
    });

    it('should keep version 1 even when retention deletes older versions', async () => {
      const updatePromptDto: UpdatePromptDto = {
        prompt: 'New prompt content',
        useDashboardOverride: true,
      };

      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (
        promptVersionRepository.getLatestPromptVersion as jest.Mock
      ).mockResolvedValue({ ...mockPromptVersion, version: 100 });
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (
        promptVersionRepository.deleteVersionsBefore as jest.Mock
      ).mockResolvedValue(undefined);

      await service.updatePrompt(mockPromptId, updatePromptDto);

      // minVersionToKeep should never be less than 1
      // With version 100 and new version 101, minVersionToKeep = max(1, 101 - 4) = 97
      const callArgs = (
        promptVersionRepository.deleteVersionsBefore as jest.Mock
      ).mock.calls[0];
      expect(callArgs[1]).toBeGreaterThanOrEqual(1);
    });
  });

  describe('updatePrompt — auto-translation trigger', () => {
    const enabledMainAgent: Prompt = {
      ...mockPrompt,
      promptType: 'main_agent',
      translationEnabled: true,
      useDashboardOverride: true,
    };

    const mockVersionCreate = () => {
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (
        promptVersionRepository.getLatestPromptVersion as jest.Mock
      ).mockResolvedValue(mockPromptVersion);
      (promptVersionRepository.create as jest.Mock).mockReturnValue(
        mockPromptVersion,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
    };

    it('fires when an enabled main_agent prompt body changes', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(
        enabledMainAgent,
      );
      mockVersionCreate();

      await service.updatePrompt(mockPromptId, { prompt: 'New body' });

      expect(translatePrompt).toHaveBeenCalledWith(mockPromptId);
    });

    it('fires when translation is just enabled (enable action)', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
        translationEnabled: false,
      });
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { translationEnabled: true });

      expect(translatePrompt).toHaveBeenCalledWith(mockPromptId);
    });

    it('does NOT fire for a disabled prompt even when the body changes', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
        translationEnabled: false,
        useDashboardOverride: true,
      });
      mockVersionCreate();

      await service.updatePrompt(mockPromptId, { prompt: 'New body' });

      expect(translatePrompt).not.toHaveBeenCalled();
    });

    it('does NOT fire for a non-translatable promptType', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'multilingual',
        translationEnabled: true,
        useDashboardOverride: true,
      });
      mockVersionCreate();

      await service.updatePrompt(mockPromptId, { prompt: 'New body' });

      expect(translatePrompt).not.toHaveBeenCalled();
    });

    it('does NOT fire when an enabled prompt is edited without a body change', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(
        enabledMainAgent,
      );
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { description: 'tweak only' });

      expect(translatePrompt).not.toHaveBeenCalled();
    });
  });

  describe('getPrompts', () => {
    it('should return array of prompts', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];

      (promptsRepository.getPrompts as jest.Mock).mockResolvedValue(
        mockPrompts,
      );

      const result = await service.getPrompts();

      expect(result).toEqual(mockPrompts);
      expect(promptsRepository.getPrompts).toHaveBeenCalledWith(
        undefined,
        true,
        undefined,
      );
    });

    it('should pass search and pagination parameters to repository', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];
      const searchName = 'AI';
      const pagination = { limit: 10, offset: 0 };

      (promptsRepository.getPrompts as jest.Mock).mockResolvedValue(
        mockPrompts,
      );

      const result = await service.getPrompts(searchName, pagination);

      expect(result).toEqual(mockPrompts);
      expect(promptsRepository.getPrompts).toHaveBeenCalledWith(
        searchName,
        true,
        pagination,
      );
    });

    it('should return empty array when no prompts exist', async () => {
      (promptsRepository.getPrompts as jest.Mock).mockResolvedValue([]);

      const result = await service.getPrompts();

      expect(result).toEqual([]);
    });

    it('should handle repository errors', async () => {
      const error = new Error('Database error');
      (promptsRepository.getPrompts as jest.Mock).mockRejectedValue(error);

      await expect(service.getPrompts()).rejects.toThrow('Database error');
    });
  });

  describe('visibleInStudio', () => {
    it('persists the flag when the DTO carries it', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { visibleInStudio: false });

      expect(promptsRepository.update).toHaveBeenCalledWith(
        mockPromptId,
        expect.objectContaining({ visibleInStudio: false }),
      );
    });

    it('leaves the flag alone when the DTO omits it', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updatePrompt(mockPromptId, { name: 'Renamed' });

      const [, updateData] = (promptsRepository.update as jest.Mock).mock
        .calls[0];
      expect(updateData).not.toHaveProperty('visibleInStudio');
    });

    it('creates a new variant visible, so it is selectable immediately', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
      });
      (promptVersionRepository.findOne as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (promptsRepository.create as jest.Mock).mockImplementation(
        (data: unknown) => data,
      );
      (promptsRepository.save as jest.Mock).mockImplementation(
        async (data: object) => ({ ...data, id: 'new-id' }),
      );
      (promptVersionRepository.create as jest.Mock).mockImplementation(
        (data: unknown) => data,
      );
      (promptVersionRepository.save as jest.Mock).mockResolvedValue(
        mockPromptVersion,
      );
      (promptsRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.duplicatePrompt(mockPromptId);

      expect(promptsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibleInStudio: true }),
      );
    });
  });

  describe('getPromptUsage — metadata key by promptType', () => {
    it('counts main_agent references via selectedMainPromptCode', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'main_agent',
      });
      dataSourceQuery.mockResolvedValue([{ count: '0' }]);

      await service.getPromptUsage(mockPromptId);

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.any(String), [
        mockPrompt.promptCode,
        'selectedMainPromptCode',
      ]);
    });

    it('counts transcript_evaluator references via selectedEvaluatorPromptCode', async () => {
      // Without the type-aware key an evaluator variant always reported zero
      // usage, so the studio would claim nothing depended on it.
      (promptsRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockPrompt,
        promptType: 'transcript_evaluator',
      });
      dataSourceQuery.mockResolvedValue([{ count: '2' }]);

      const result = await service.getPromptUsage(mockPromptId);

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.any(String), [
        mockPrompt.promptCode,
        'selectedEvaluatorPromptCode',
      ]);
      expect(result.count).toBe(2);
    });

    it('falls back to selectedMainPromptCode for an untyped prompt', async () => {
      (promptsRepository.findOne as jest.Mock).mockResolvedValue(mockPrompt);
      dataSourceQuery.mockResolvedValue([{ count: '0' }]);

      await service.getPromptUsage(mockPromptId);

      expect(dataSourceQuery).toHaveBeenCalledWith(expect.any(String), [
        mockPrompt.promptCode,
        'selectedMainPromptCode',
      ]);
    });
  });
});
