import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, SelectQueryBuilder } from 'typeorm';
import { PromptsRepository } from '../prompt.repository';
import { Prompt } from '../../entity/prompt.entity';
import { PromptSortBy } from '../../enum/prompt-sort-by.enum';
import { SortOrder } from 'src/user/enum/user.enum';
import {
  PromptResponse,
  PromptDetailResponse,
} from '../../type/prompt-response.type';

describe('PromptsRepository', () => {
  let repository: PromptsRepository;
  let queryBuilder: Partial<SelectQueryBuilder<Prompt>>;

  const mockPromptId = '123e4567-e89b-12d3-a456-426614174000';

  const mockPromptResponse: PromptResponse = {
    id: mockPromptId,
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    createdAt: new Date('2026-02-09'),
    prompt: 'This is the prompt content for AI learning',
  };

  const mockPromptDetailResponse: PromptDetailResponse = {
    id: mockPromptId,
    promptCode: 'ally_ai_learn',
    name: 'AI Learning Prompt',
    description: 'A prompt for AI learning',
    currentVersion: 1,
    createdAt: new Date('2026-02-09'),
    updatedAt: new Date('2026-02-09'),
    prompt: 'This is the prompt content for AI learning',
  };

  beforeEach(async () => {
    // Create mock QueryBuilder
    queryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setParameters: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
    };

    // Create mock DataSource
    const mockDataSource = {
      createEntityManager: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PromptsRepository,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    repository = module.get<PromptsRepository>(PromptsRepository);

    // Mock createQueryBuilder method
    jest
      .spyOn(repository, 'createQueryBuilder')
      .mockReturnValue(queryBuilder as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPromptById', () => {
    it('should return prompt detail by id', async () => {
      (queryBuilder.getRawOne as jest.Mock).mockResolvedValue(
        mockPromptDetailResponse,
      );

      const result = await repository.getPromptById(mockPromptId);

      expect(result).toEqual(mockPromptDetailResponse);
      expect(queryBuilder.leftJoin).toHaveBeenCalled();
      expect(queryBuilder.addSelect).toHaveBeenCalled();
      expect(queryBuilder.where).toHaveBeenCalledWith('prompt.id = :id', {
        id: mockPromptId,
      });
      expect(queryBuilder.getRawOne).toHaveBeenCalled();
    });

    it('should return null when prompt not found', async () => {
      (queryBuilder.getRawOne as jest.Mock).mockResolvedValue(null);

      const result = await repository.getPromptById('invalid-id');

      expect(result).toBeNull();
    });

    it('should join with prompts_versions table', async () => {
      (queryBuilder.getRawOne as jest.Mock).mockResolvedValue(
        mockPromptDetailResponse,
      );

      await repository.getPromptById(mockPromptId);

      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'prompts_versions',
        'pv',
        expect.any(String),
      );
    });

    it('should select prompt content from version', async () => {
      (queryBuilder.getRawOne as jest.Mock).mockResolvedValue(
        mockPromptDetailResponse,
      );

      await repository.getPromptById(mockPromptId);

      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'pv.prompt',
        'prompt',
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      (queryBuilder.getRawOne as jest.Mock).mockRejectedValue(error);

      await expect(repository.getPromptById(mockPromptId)).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('getPrompts', () => {
    it('should return array of prompts without filters', async () => {
      const mockPrompts: PromptResponse[] = [
        mockPromptResponse,
        {
          ...mockPromptResponse,
          id: '223e4567-e89b-12d3-a456-426614174001',
          promptCode: 'ally_learn_path',
          name: 'Learning Path',
        },
      ];

      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockPrompts);

      const result = await repository.getPrompts();

      expect(result).toEqual(mockPrompts);
      expect(queryBuilder.select).toHaveBeenCalled();
      expect(queryBuilder.addSelect).toHaveBeenCalled();
      expect(queryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should return empty array when no prompts exist', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const result = await repository.getPrompts();

      expect(result).toEqual([]);
    });

    it('should search prompts by name', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockPrompts);

      const searchName = 'AI';
      const result = await repository.getPrompts(searchName);

      expect(result).toEqual(mockPrompts);
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        '(prompt.promptCode ILIKE :searchName OR prompt.name ILIKE :searchName OR prompt.description ILIKE :searchName) OR (pv.prompt ILIKE :searchName) OR (prompt.useCase ILIKE :searchName)',
      );
      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: `%${searchName}%`,
      });
    });

    it('should search prompts by description', async () => {
      const mockPrompts: PromptResponse[] = [mockPromptResponse];
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue(mockPrompts);

      const searchName = 'learning';
      await repository.getPrompts(searchName);

      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: `%${searchName}%`,
      });
    });

    it('should apply pagination with limit and offset', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { limit: 10, offset: 20, order: SortOrder.ASC };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).toHaveBeenCalledWith(20);
    });

    it('should apply default sorting by createdAt', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { order: SortOrder.ASC };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `prompt.${PromptSortBy.CREATED_AT}`,
        SortOrder.ASC,
      );
    });

    it('should apply custom sorting by name', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = {
        sortBy: PromptSortBy.NAME,
        order: SortOrder.DESC,
      };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `prompt.${PromptSortBy.NAME}`,
        SortOrder.DESC,
      );
    });

    it('should apply custom sorting by updatedAt', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = {
        sortBy: PromptSortBy.UPDATED_AT,
        order: SortOrder.DESC,
      };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `prompt.${PromptSortBy.UPDATED_AT}`,
        SortOrder.DESC,
      );
    });

    it('should ignore invalid sortBy and use default', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { sortBy: 'invalidSort', order: SortOrder.ASC };
      await repository.getPrompts(undefined, pagination);

      // Should fallback to CREATED_AT
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        `prompt.${PromptSortBy.CREATED_AT}`,
        SortOrder.ASC,
      );
    });

    it('should apply only limit without offset', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { limit: 10 };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.limit).toHaveBeenCalledWith(10);
      expect(queryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should apply only offset without limit', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { offset: 20 };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.offset).toHaveBeenCalledWith(20);
      expect(queryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should combine search and pagination', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { limit: 10, offset: 5, order: SortOrder.ASC };
      await repository.getPrompts('AI', pagination);

      expect(queryBuilder.andWhere).toHaveBeenCalled();
      expect(queryBuilder.setParameters).toHaveBeenCalled();
      expect(queryBuilder.limit).toHaveBeenCalled();
      expect(queryBuilder.offset).toHaveBeenCalled();
    });

    it('should select all required prompt fields', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      await repository.getPrompts();

      // Check that select was called with id
      expect(queryBuilder.select).toHaveBeenCalledWith('prompt.id', 'id');
      // Check that addSelect was called multiple times for other fields
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'prompt.promptCode',
        'promptCode',
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'prompt.name',
        'name',
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'prompt.description',
        'description',
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'prompt.createdAt',
        'createdAt',
      );
      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'pv.prompt',
        'prompt',
      );
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      (queryBuilder.getRawMany as jest.Mock).mockRejectedValue(error);

      await expect(repository.getPrompts()).rejects.toThrow(
        'Database connection failed',
      );
    });

    it('should handle search with special characters', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const searchName = '%AI%Learn%';
      await repository.getPrompts(searchName);

      expect(queryBuilder.setParameters).toHaveBeenCalledWith({
        searchName: `%${searchName}%`,
      });
    });
  });

  describe('Query Building', () => {
    it('should build correct query with join', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      await repository.getPrompts();

      expect(repository.createQueryBuilder).toHaveBeenCalledWith('prompt');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(
        'prompts_versions',
        'pv',
        expect.stringContaining('prompt'),
      );
    });

    it('should use getRawMany for list queries', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      await repository.getPrompts();

      expect(queryBuilder.getRawMany).toHaveBeenCalled();
    });

    it('should use getRawOne for detail queries', async () => {
      (queryBuilder.getRawOne as jest.Mock).mockResolvedValue(null);

      await repository.getPromptById(mockPromptId);

      expect(queryBuilder.getRawOne).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty search string', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const result = await repository.getPrompts('');

      // Empty string is falsy, so should not apply search
      expect(queryBuilder.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle null pagination options', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const result = await repository.getPrompts(undefined, undefined);

      expect(result).toEqual([mockPromptResponse]);
      expect(queryBuilder.limit).not.toHaveBeenCalled();
      expect(queryBuilder.offset).not.toHaveBeenCalled();
    });

    it('should handle zero limit', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([]);

      const pagination = { limit: 0 };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.limit).not.toHaveBeenCalled();
    });

    it('should handle zero offset', async () => {
      (queryBuilder.getRawMany as jest.Mock).mockResolvedValue([
        mockPromptResponse,
      ]);

      const pagination = { offset: 0 };
      await repository.getPrompts(undefined, pagination);

      expect(queryBuilder.offset).not.toHaveBeenCalled();
    });
  });
});
